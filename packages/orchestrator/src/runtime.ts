import { createActor, type Actor } from 'xstate';
import { defaultAutonomy, type AutonomyConfig } from '@ripple/shared';
import { featureMachine, type FeatureEvent } from './machine.ts';
import { Journal, type JournalEntry } from './journal.ts';
import type { LLM } from './adapters/llm.ts';
import { planFeature, type Plan } from './planner.ts';
import type { Builder, BuildResult } from './adapters/builder.ts';
import type { ApplyResult, Integrator } from './adapters/integrator.ts';
import { buildPrompt } from './build-prompt.ts';
import { join } from 'node:path';
import type { VisualReviewer } from './visual/reviewer.ts';
import type { BeforeShooter } from './adapters/before.ts';
import { imageInfo } from './visual/image.ts';
import { readFileSync } from 'node:fs';
import type { VisualReport } from './visual/types.ts';
import type { ProjectStore } from './projects.ts';
import { AutoFixStore, applyFix, diagnose, type Diagnosis } from './recovery.ts';

// A step that failed and is waiting for the user to accept (or refuse) the proposed fix.
export interface Failure extends Diagnosis {
  id: number; // journal id of the FAILURE entry
  agent: string;
  message: string;
}

// Which success entry of the journal closes a failure of which agent.
const SUCCESS_OF: Record<string, string> = { PLAN: 'planner', BUILD: 'builder', BEFORE: 'before', VISUAL: 'visual', MERGE: 'integrator' };

interface Brief {
  title: string;
  design: string;
  projectId: string;
  mockup?: string; // path of the mockup image the build is checked against
  figma?: string; // link of the Figma frame the mockup comes from
}

interface Feature extends Brief {
  actor: Actor<typeof featureMachine>;
  autonomy: AutonomyConfig;
  visual?: VisualReport;
  before?: string; // file of the screenshot of the app before the feature
  shootingBefore?: boolean;
  plan?: Plan;
  build?: BuildResult;
  merge?: ApplyResult;
  pushOnMerge?: boolean;
  feedback?: string;
  failure?: Failure;
  autoTried: Set<string>; // agents whose failure was already auto-fixed once: a second one goes to the user, so a fix cannot loop
}

// Owns the running features: every state change and agent result is written to the journal and pushed to listeners (SSE).
// The journal is the source of truth: on start, features are rebuilt by replaying it (so `node --watch` restarts keep state).
export class Runtime {
  readonly journal: Journal;
  #features = new Map<string, Feature>();
  #listeners = new Set<(e: JournalEntry) => void>();
  #llm: LLM;
  #builder?: Builder;
  #integrator?: Integrator;
  #reviewer?: VisualReviewer;
  #beforeShooter?: BeforeShooter;
  #visualDir: string;
  #projects?: ProjectStore;
  readonly autoFix: AutoFixStore;

  constructor(o: { llm: LLM; journal?: Journal; builder?: Builder; integrator?: Integrator; reviewer?: VisualReviewer; beforeShooter?: BeforeShooter; visualDir?: string; projects?: ProjectStore; autoFix?: AutoFixStore }) {
    this.#llm = o.llm;
    this.#builder = o.builder;
    this.#integrator = o.integrator;
    this.#reviewer = o.reviewer;
    this.#beforeShooter = o.beforeShooter;
    this.#visualDir = o.visualDir ?? 'out/visual';
    this.#projects = o.projects;
    this.autoFix = o.autoFix ?? new AutoFixStore();
    this.journal = o.journal ?? new Journal();
    this.#restore();
  }

  subscribe(fn: (e: JournalEntry) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #log(featureId: string, type: string, payload: unknown = {}) {
    const entry = this.journal.append(featureId, type, payload);
    for (const fn of this.#listeners) fn(entry);
    return entry;
  }

  #spawn(featureId: string, brief: Brief, autonomy: AutonomyConfig): Feature {
    const actor = createActor(featureMachine, { input: { featureId, autonomy } });
    const feature: Feature = { actor, autonomy, autoTried: new Set(), ...brief };
    this.#features.set(featureId, feature);
    return feature;
  }

  // Logs state changes and starts the agent that owns the new state. Attached after any replay.
  #watch(featureId: string, feature: Feature) {
    let last = String(feature.actor.getSnapshot().value);
    feature.actor.subscribe(s => {
      const v = String(s.value);
      if (v === last) return;
      last = v;
      this.#log(featureId, 'STATE', { state: v });
      if (v === 'BUILDING') { void this.#build(featureId, feature); void this.#before(featureId, feature); }
      if (v === 'VISUAL_CHECK') void this.#visual(featureId, feature);
      // `medium`: the merge goes ahead on its own only when the visual check passed. Never pushes.
      if (v === 'PR_READY' && feature.autonomy.merge === 'medium' && feature.visual?.verdict === 'pass') {
        queueMicrotask(() => this.#dispatch(featureId, feature, { type: 'APPROVE', gate: 'merge', by: 'agent' }));
      }
      if (v === 'MERGING') void this.#merge(featureId, feature);
    });
  }

  #restore() {
    const byFeature = new Map<string, JournalEntry[]>();
    for (const e of this.journal.list()) byFeature.set(e.featureId, [...(byFeature.get(e.featureId) ?? []), e]);
    for (const [id, entries] of byFeature) {
      const created = entries.find(e => e.type === 'CREATED');
      if (!created) continue;
      const p = created.payload as Brief & { autonomy: AutonomyConfig };
      const f = this.#spawn(id, { title: p.title, design: p.design, projectId: p.projectId, mockup: p.mockup, figma: p.figma }, p.autonomy);
      f.actor.start();
      for (const e of entries) {
        if (e.type === 'PLAN') f.plan = e.payload as Plan;
        else if (e.type === 'BUILD') { f.build = e.payload as BuildResult; f.visual = undefined; }
        else if (e.type === 'VISUAL') f.visual = e.payload as VisualReport;
        else if (e.type === 'BEFORE') f.before = (e.payload as { file: string }).file;
        else if (e.type === 'MERGE') f.merge = e.payload as ApplyResult;
        else if (e.type === 'EVENT') this.#apply(f, e.payload as FeatureEvent);
        else if (e.type === 'FAILURE') f.failure = { id: e.id, ...(e.payload as Omit<Failure, 'id'>) };
        else if (e.type === 'RECOVERY' && f.failure?.id === (e.payload as { failureId: number }).failureId) f.failure = undefined;
        if (f.failure && SUCCESS_OF[e.type] === f.failure.agent) f.failure = undefined;
      }
      this.#watch(id, f);
      // Work interrupted by the restart is picked up again.
      // A step with a failure still waiting for the user is not retried behind their back.
      const state = String(f.actor.getSnapshot().value);
      const waiting = (agent: string) => f.failure?.agent === agent;
      if (state === 'DESIGN_DEFINED' && !f.plan && !waiting('planner')) void this.#plan(id, f);
      if (state === 'BUILDING' && !waiting('builder')) void this.#build(id, f);
      // Before the merge, `main` is still the app as it was: a missing shot can be taken now.
      if (['DESIGN_DEFINED', 'PLANNED', 'BUILDING'].includes(state) && !waiting('before')) void this.#before(id, f);
      if (state === 'MERGING' && !waiting('integrator')) void this.#merge(id, f);
      if (state === 'VISUAL_CHECK' && !f.visual && !waiting('visual')) void this.#visual(id, f);
    }
  }

  #apply(feature: Feature, event: FeatureEvent) {
    if (event.type === 'VISUAL_DIFF') feature.feedback = event.feedback;
    if (event.type === 'APPROVE' && event.gate === 'merge') feature.pushOnMerge = event.push === true;
    feature.actor.send(event);
  }

  #dispatch(featureId: string, feature: Feature, event: FeatureEvent) {
    this.#log(featureId, 'EVENT', event);
    this.#apply(feature, event);
  }

  // Registers the feature, then runs the planner in the background. Returns once the feature exists.
  create(featureId: string, brief: Brief, autonomy: AutonomyConfig = defaultAutonomy) {
    if (this.#features.has(featureId)) throw new Error(`feature ${featureId} already exists`);
    this.#log(featureId, 'CREATED', { ...brief, autonomy });
    const feature = this.#spawn(featureId, brief, autonomy);
    feature.actor.start();
    this.#log(featureId, 'STATE', { state: String(feature.actor.getSnapshot().value) });
    this.#watch(featureId, feature);
    void this.#plan(featureId, feature);
    void this.#before(featureId, feature); // the app as it is today: known from the start
    return this.get(featureId)!;
  }

  async #plan(featureId: string, feature: Feature) {
    try {
      feature.plan = await planFeature(this.#llm, { title: feature.title, design: feature.design });
      this.#ok(feature, 'planner');
      this.#log(featureId, 'PLAN', feature.plan);
      this.#dispatch(featureId, feature, { type: 'PLAN_READY' });
      // `medium`: the planner decides whether the plan needs a human look.
      if (feature.autonomy.plan === 'medium' && !feature.plan.needsInput) this.#dispatch(featureId, feature, { type: 'APPROVE', gate: 'plan', by: 'agent' });
    } catch (e) {
      await this.#fail(featureId, feature, 'planner', e);
    }
  }

  async #build(featureId: string, feature: Feature) {
    if (!this.#builder || !feature.plan) return;
    try {
      const prompt = buildPrompt({ title: feature.title, design: feature.design }, feature.plan, feature.feedback);
      const project = this.#projects?.get(feature.projectId);
      if (!project) throw new Error(`project ${feature.projectId} not found`);
      feature.build = await this.#builder.build({ projectId: project.id, repoPath: project.path, featureId, prompt });
      feature.visual = undefined; // belongs to the previous build
      this.#ok(feature, 'builder');
      this.#log(featureId, 'BUILD', feature.build);
      this.#dispatch(featureId, feature, { type: 'BUILD_DONE' });
    } catch (e) {
      await this.#fail(featureId, feature, 'builder', e);
    }
  }

  // The app as it is on the base branch, shot as soon as the feature exists (and retried when the build starts).
  // A failure here never blocks anything.
  async #before(featureId: string, feature: Feature) {
    if (!this.#beforeShooter || feature.before || feature.shootingBefore) return;
    const project = this.#projects?.get(feature.projectId);
    if (!project) return;
    feature.shootingBefore = true;
    try {
      // Same size as the design, so before, after and design line up.
      const info = feature.mockup ? imageInfo(readFileSync(feature.mockup)) : null;
      await this.#beforeShooter.shoot({
        projectId: project.id, repoPath: project.path, featureId,
        viewport: { width: info?.width ?? 1280, height: info?.height ?? 800 },
        outFile: join(this.#visualDir, featureId, 'before.png'),
      });
      feature.before = 'before.png';
      this.#ok(feature, 'before');
      this.#log(featureId, 'BEFORE', { file: feature.before });
    } catch (e) {
      await this.#fail(featureId, feature, 'before', e);
    } finally {
      feature.shootingBefore = false;
    }
  }

  // Compares the build with the mockup. Whether the verdict is acted on depends on the `visual` autonomy.
  async #visual(featureId: string, feature: Feature) {
    if (!this.#reviewer) return;
    if (!feature.mockup || !feature.build?.worktree) {
      this.#log(featureId, 'VISUAL_SKIPPED', { reason: feature.mockup ? 'no worktree for this build' : 'no mockup attached: check it by hand' });
      return;
    }
    try {
      const report = await this.#reviewer.review({
        featureId, design: feature.design, worktree: feature.build.worktree, mockupFile: feature.mockup, outDir: join(this.#visualDir, featureId),
      });
      feature.visual = report;
      this.#ok(feature, 'visual');
      this.#log(featureId, 'VISUAL', report);
      if (String(feature.actor.getSnapshot().value) !== 'VISUAL_CHECK') return; // the user decided meanwhile
      const level = feature.autonomy.visual;
      if (report.verdict === 'pass' && level !== 'low') this.#dispatch(featureId, feature, { type: 'VISUAL_OK' });
      else if (report.verdict === 'fail' && level === 'high') this.#dispatch(featureId, feature, { type: 'VISUAL_DIFF', feedback: report.feedback });
    } catch (e) {
      await this.#fail(featureId, feature, 'visual', e);
    }
  }

  // Runs the visual check again on the current build (after fixing something by hand, for instance).
  reviewAgain(featureId: string) {
    const f = this.#features.get(featureId);
    if (!f) throw new Error(`unknown feature ${featureId}`);
    if (String(f.actor.getSnapshot().value) !== 'VISUAL_CHECK') throw new Error('the feature is not at the visual check');
    void this.#visual(featureId, f);
  }

  async #merge(featureId: string, feature: Feature) {
    if (!this.#integrator) return;
    try {
      const project = this.#projects?.get(feature.projectId);
      if (!project) throw new Error(`project ${feature.projectId} not found`);
      // Never push unless the user ticked it for this approval, and only if the project has a remote.
      const push = feature.pushOnMerge === true && project.repoUrl !== '';
      feature.merge = await this.#integrator.apply({ projectId: project.id, repoPath: project.path, featureId, push });
      this.#ok(feature, 'integrator');
      this.#log(featureId, 'MERGE', feature.merge);
      this.#dispatch(featureId, feature, { type: 'MERGE_DONE' });
    } catch (e) {
      this.#dispatch(featureId, feature, { type: 'MERGE_FAILED' });
      await this.#fail(featureId, feature, 'integrator', e);
    }
  }

  #ok(feature: Feature, agent: string) {
    feature.autoTried.delete(agent);
    if (feature.failure?.agent === agent) feature.failure = undefined;
  }

  // A step failed: say where and why, propose one fix, and wait. A fix the user chose to always apply goes ahead on its own,
  // once per failure, so a fix that does not work cannot loop.
  async #fail(featureId: string, feature: Feature, agent: string, e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    this.#log(featureId, 'ERROR', { agent, message });
    const project = this.#projects?.get(feature.projectId);
    if (!project) return;
    const d = await diagnose({ agent, message, repoPath: project.path, featureId, llm: this.#llm });
    const entry = this.#log(featureId, 'FAILURE', { agent, message, ...d });
    feature.failure = { id: entry.id, agent, message, ...d };
    if (this.autoFix.has(d.fix.kind) && !feature.autoTried.has(agent)) {
      feature.autoTried.add(agent);
      await this.resolveFailure(featureId, { action: 'apply', auto: true });
    }
  }

  // The user's answer to a failure: apply the proposed fix (optionally for good) and rerun the step, or leave it.
  async resolveFailure(featureId: string, a: { action: 'apply' | 'dismiss'; always?: boolean; auto?: boolean }) {
    const f = this.#features.get(featureId);
    if (!f) throw new Error(`unknown feature ${featureId}`);
    const fail = f.failure;
    if (!fail) throw new Error('nothing to resolve');
    f.failure = undefined;
    this.#log(featureId, 'RECOVERY', { failureId: fail.id, action: a.action, kind: fail.fix.kind, always: a.always === true, auto: a.auto === true });
    if (a.action === 'dismiss') return this.get(featureId)!;
    if (a.always) this.autoFix.enable(fail.fix.kind);
    const project = this.#projects?.get(f.projectId);
    if (!project) throw new Error(`project ${f.projectId} not found`);
    try {
      this.#log(featureId, 'FIX', { kind: fail.fix.kind, result: await applyFix(fail.fix.kind, { repoPath: project.path, featureId }) });
    } catch (e) {
      await this.#fail(featureId, f, fail.agent, e);
      return this.get(featureId)!;
    }
    const state = String(f.actor.getSnapshot().value);
    if (fail.agent === 'planner') void this.#plan(featureId, f);
    else if (fail.agent === 'builder' && state === 'BUILDING') void this.#build(featureId, f);
    else if (fail.agent === 'before') void this.#before(featureId, f);
    else if (fail.agent === 'visual' && state === 'VISUAL_CHECK') void this.#visual(featureId, f);
    else if (fail.agent === 'integrator' && state === 'MERGE_FAILED') this.#dispatch(featureId, f, { type: 'APPROVE', gate: 'merge', push: f.pushOnMerge });
    return this.get(featureId)!;
  }

  send(featureId: string, event: FeatureEvent) {
    const f = this.#features.get(featureId);
    if (!f) throw new Error(`unknown feature ${featureId}`);
    this.#dispatch(featureId, f, event);
    return this.get(featureId)!;
  }

  get(featureId: string) {
    const f = this.#features.get(featureId);
    if (!f) return undefined;
    return {
      id: featureId,
      projectId: f.projectId,
      title: f.title,
      design: f.design,
      state: String(f.actor.getSnapshot().value),
      plan: f.plan,
      build: f.build,
      merge: f.merge,
      visual: f.visual,
      hasMockup: Boolean(f.mockup),
      before: f.before,
      figma: f.figma,
      mockupFile: f.mockup?.split('/').pop(),
      feedback: f.feedback,
      failure: f.failure,
    };
  }

  // Summaries only: the diff can be large.
  list() {
    return [...this.#features.keys()].map(id => {
      const { build, ...rest } = this.get(id)!;
      return { ...rest, build: build && { branch: build.branch, stat: build.stat } };
    });
  }
}
