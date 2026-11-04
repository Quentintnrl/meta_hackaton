# Ripple_handoff, the docs

The [README](../README.md) says what it is and how to try it. Here: how it works, page by page, what the API does, everything to configure, and how to develop. Also available [en français](DOC.fr.md).

## Contents

1. [The loop](#the-loop)
2. [The pages](#the-pages)
3. [The post editor](#the-post-editor)
4. [How the Meta Model API is used](#how-the-meta-model-api-is-used)
5. [The demo dataset](#the-demo-dataset)
6. [Full configuration](#full-configuration)
7. [Develop](#develop)
8. [Dev pipeline](#dev-pipeline)

## The loop

| The team does on its own | You decide |
|---|---|
| One pass a day when it is *on duty*: web research, reading the posts, proposals only when nothing waits for your decision | Yes, no, or "rewrite" on every proposal |
| The drafts of accepted pieces, three days before their date (*Writer drafts ahead*) | What is approved and when it is posted |
| Matching a posted piece with the real post, and reading it a week later | The standing orders every agent reads ("never a price") |
| The format plan, rewritten after every pass | Stop, at any time, during a pass |

Nothing is written or posted without your click. A pass the team starts itself says so on the first line of the log ("On duty: started this pass on its own, nobody asked"). A pass stops with one button: the model call in flight is aborted, the remaining agents are skipped, what was already saved stays. A refusal can be taken back ("Take it back") and stays in the piece's chain. Every piece keeps its chain: who did what, when.

Every agent leaves a trace, shown under its work and on its page:
- **How the Scout worked**: every search, every page opened, the ones that refused it.
- **How the Analyst worked**: the posts read and their dates, the facts computed without the model, the field research taken into account, your orders, the number of calls.
- **How the Strategist worked**: the field research, the Analyst's reading, the roadmap, what is already planned, the posted pieces and their numbers, your refusals, your brief, the number of calls, how many pieces came out.

These lines are counted by the server before the call, never written by the model.

## The pages

**Create.** The first screen. At the top, what the team did while you were away (one line per agent, the badge "on its own, nobody asked" when it passed alone, the count of new proposals), then the brief ("What do you want to say, and to whom?"), then the thread of a post in five columns: proposed, being written, to review, ready to post, posted. Every card carries the one button it waits for. Sort by date, newest or channel; filter by kind and channel; refused pieces to take back. A proposal says the situation, who exactly it is for, the first line, the channel, and what will be counted a week later. A posted piece is matched with its real post (on its own when the first words match, proposed and confirmed on the date otherwise) and shows "N days after": likes, comments, shares, views, against what was promised. The browser tab shows how many pieces wait for you and who is working.

**Platforms.** One card per network: followers, real rhythm over 16 weeks, what a post gets there, the current week against the target you set (posted, planned, slots to fill, a button that asks the Strategist what is missing before Sunday), what is planned and what worked, the field to paste your posts or your follower count. "Export the approved pieces (ZIP)": a `posts.csv` and one folder per piece (caption, pictures) for Buffer, Later or Business Suite.

**Community.** The story of the account drawn (one bar per post, silences greyed and named, the best post annotated), then what the posts say, counted without the model (drift of likes, question or not, length, weekday, words of the best third, reach against reactions on LinkedIn), and under every drawing the Analyst's reading: the action first, the meaning next. Then the diagnosis and up to three fixes, each with a button that hands the first step to the Writer.

**Competitors.** The market as the Scout sees it: one row per player (who they are, how they communicate: rhythm, formats, subjects, tone, who speaks, what they ask; what they leave you and the lesson), the audience's dates, the posts to take inspiration from with their link and "Do our version", and the Scout's trail.

**Calendar.** The audience's dates and your pieces on the same days, three months. At the top, the dates with nothing planned around them, with a button that plans a post five days before. Dragging a piece onto another day locks its date there; posted pieces do not move.

**Settings.** Voice, audience, content language, standing orders, publishing mode (by hand, via a scheduler, via a Meta app), *Team on duty*, *Writer drafts ahead*. Every field says which agent reads it.

**Agents.** One page per agent: on/off, parallel resources (1 to 3: several angles for the Scout, several lenses for the Strategist, parallel drafts for the Writer), behaviour in your own words, last result in numbers, trail, chat. The Director is the entry point: it proposes what to run as buttons, sends you to the agent concerned, and sums up every pass. The "Ask the team" dock at the foot of the page routes the question to the agent that has the material.

The older pages (Today, Insights, Team, Roadmap) stay reachable by URL.

**Interface language.** English or French, switch at the bottom of the sidebar, remembered in the browser; `?lang=fr` in the URL forces French once. Agent names stay in English. The language of the content produced is set in *Settings*.

## The post editor

Format (image, carousel of 2 to 10 slides, video as a storyboard), text, hashtags (cleaned like the server does, 20 max), one description per picture or shot. Pictures are generated by Muse Image **on request** (one button per picture or "Generate missing pictures"; a picture is kept as long as its description does not change). "Use my photo" puts your own picture (JPEG, PNG or WebP, 8 MB) on a slide with no model call. For a video, the studio assembles a local slideshow of the keyframes (slow zoom, text overlay, vertical MP4 720×1280, ffmpeg, no token) until Meta opens video generation. The preview shows how it looks in a feed. An approved piece is written to `out/content/<project>/`; "Copy caption" copies the exact text, "Mark posted" records that you posted it.

## How the Meta Model API is used

Everything goes through one adapter, `packages/orchestrator/src/adapters/llm.ts`, on the Responses endpoint.

| Agent | Call | What we get |
|---|---|---|
| Scout | **Tool loop**: `search` (grounded search) and `open` (public page read as text), up to 14 calls, `function_call` → execution → `function_call_output` on `previous_response_id`, then an answer in strict JSON | One real pass: 45 searches, 14 pages opened, numbers and dates read on the pages, refusals said as they are. Without a tool backend: two searches and one condensation |
| Analyst, Strategist, Director | **Strict JSON** (`muse-spark-1.3`), zod schema on the server, facts computed by the server and quoted to the model | Readings that do not repeat the numbers, proposals with their evidence, a plan with its levers |
| Writer | Strict JSON + **Muse Image** (`muse-image-1.0`) on request; existing pictures are sent back as input on a rewrite | A complete post: format, text, hashtags, pictures that match the text |
| All | `AbortSignal` passed to every fetch and checked between two turns of the tool loop | The Stop button |

Every button that calls the model says what it costs and how long it takes. A Scout pass takes a few minutes and as many calls as steps.

## The demo dataset

`pnpm dev:demo` fills `out/demo/` then runs the app on it on other ports (orchestrator 8790, interface 5190), next to your usual `pnpm dev`; run it again to start from an identical set, `pnpm seed:demo` fills without running. The "Mairie360 (demo)" project holds the 27 real Instagram posts of @mairie360 and the 5 real posts of its LinkedIn page (read on 2 November 2026, `packages/orchestrator/src/demo/account.json`, nothing is scraped at launch), and the team's real work that day (`real.json`: audit, field watch with its links, the Analyst's reading, four proposals, plan, note), plus the Analyst's and Strategist's trails recounted on that data. The last pass is marked as started by the team on its own. Only the goal and the four pieces in progress are hand-written.

## Full configuration

Every feature that needs something from you is listed here. **When one is added, it goes here and in the README.**

### On the machine

| Tool | For | Required |
|---|---|---|
| Node 24 | the orchestrator (built-in SQLite, native TypeScript) | yes |
| pnpm 12 | `corepack enable --install-directory ~/.local/bin`, then `export PATH=$HOME/.local/bin:$PATH` | yes |
| git | branches and worktrees of the dev pipeline | yes |
| ffmpeg with an H.264 encoder (`libx264` or `libopenh264`) | the local slideshow of a video post: `sudo dnf install ffmpeg` or `brew install ffmpeg`, check with `ffmpeg -encoders \| grep 264` | video only; without it the button shows the error |
| Google Chrome | the visual check of the dev pipeline | dev pipeline |
| [Muse Code](https://dev.meta.ai/docs/muse-code) (`muse` in the `PATH`) | the Builder of the dev pipeline | dev pipeline |
| [GitHub CLI](https://cli.github.com) (`gh auth login`) | creating a GitHub repository from "From scratch" | dev pipeline |

### Secrets: `.env` at the root

Copy `.env.example` to `.env`. The file is ignored by git, never commit it.

| Variable | What it is | Where to get it | Required |
|---|---|---|---|
| `MODEL_API_KEY` | Meta Model API key (Muse Spark, Muse Image, SAM 3.1) | [dev.meta.ai](https://dev.meta.ai) | yes |
| `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN` | the app reads the Instagram account itself | below | no: without them you paste your posts on *Platforms* |
| `FIGMA_TOKEN` | Figma read token, from the account dedicated to the hackathon, file shared read-only | Figma, Settings, Security, Personal access tokens | dev pipeline only |

`MODEL_API_KEY` is read at startup: restart `pnpm dev` after changing it. The Instagram and Figma tokens are re-read on every call. Optional variables: `PORT` (default 8787), `JOURNAL_PATH` (`out/journal.db`), `PROJECTS_PATH` (`out/projects.db`), `CONTENT_PATH` (`out/content.db`), `CONTENT_DIR` (`out/content`). `scripts/api-smoke.mjs` checks that your Meta key answers: `node scripts/api-smoke.mjs`.

### Instagram read by the app

1. The Instagram account must be **professional** (Creator or Business) and **linked to a Facebook Page** (Instagram, Settings, Accounts Center).
2. Create an app on [developers.facebook.com](https://developers.facebook.com), type *Business*, add the *Instagram Graph API* product.
3. In the [Graph API Explorer](https://developers.facebook.com/tools/explorer), pick your app, request `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, generate a user token.
4. Call `me/accounts?fields=instagram_business_account`: the `instagram_business_account.id` field is your `INSTAGRAM_USER_ID`.
5. Extend the token (*Access Token Debugger*, "Extend", 60 days) and paste it into `INSTAGRAM_ACCESS_TOKEN`.

With both variables, the app reads the account (posts, likes, comments, saves, shares, reach, followers) on every pass and on the *Read it now* button. Without a token, nothing is read or scraped.

### LinkedIn

LinkedIn does not open the Pages API without app review and forbids scraping. The path: page admin, *Analytics*, *Content*, *Export*; copy the "Updates" sheet (or "Mises à jour") and paste it into the LinkedIn card on *Platforms*. Columns are recognised in English or French (title, date, impressions, reactions, comments, reposts), read exactly with no model call.

## Develop

```bash
pnpm dev          # orchestrator on :8787, interface on http://localhost:5173
pnpm test         # node:test, both packages, ~12 s
pnpm typecheck    # must pass before any commit
```

pnpm monorepo:
- `packages/orchestrator`: Hono, Node's SQLite, zod, Node 24 native TypeScript. The team in `src/content/team.ts`, the pieces service in `src/content/service.ts`, the routes in `src/content/routes.ts`, the Meta adapter in `src/adapters/llm.ts`, the demo dataset in `src/demo/`.
- `packages/console`: React 19, Vite 7, hash routing. The studio in `src/studio/`, the client API in `src/api.ts`, the translations in `src/i18n/` (one key = the English sentence, one file per screen).
- `packages/shared`.

Tests: `node:test` + `assert/strict`, co-located (`*.test.ts` next to the source), readable sentences that describe the behaviour, imports with the `.ts` extension, a fake model per file (`setup()` at the top of every content/team test). `pnpm --filter orchestrator test` (~12 s; the slow tests are the ones that dig into git and temporary folders). The console has no component harness: `pnpm typecheck` then a check on the demo. The pnpm store is read-only: no package can be added.

To look at the interface without touching an already running server: `ORCHESTRATOR_URL=http://localhost:<port> pnpm --filter @ripple/console exec vite --port <other port>`. If you see `ENETUNREACH`, the orchestrator already runs with `--dns-result-order=ipv4first`.

Everything generated goes to `out/` (ignored by git): journal, databases, worktrees (`out/worktrees/`), cloned repositories (`out/projects/`), visual check captures (`out/visual/`), exported pieces (`out/content/`), demo (`out/demo/`).

The Mealkinator app is a separate project, in `../mealkinator`.

## Dev pipeline

Hidden from the interface, intact on the server. The project started as a dev team driven by Figma: a Figma frame linked to a feature, planning, building by Muse Code on a branch, visual check of the app against the frame ("before" captures on `main` and "after" on the branch), merge. Design in [DESIGN.md](DESIGN.md).

- Projects are created *From GitHub* (`https://…` or `git@…` URL, cloned into `out/projects/`), *From scratch* (name, description, GitHub repository creation as a checkbox) or *Local folder*.
- A feature: a title, the Figma frame link (right-click the frame, Copy link to selection; screen-sized, 200 to 3000 px) or notes, and the autonomy level.
- The visual check needs a `dev` script that accepts `--host`, `--port` and `--strictPort` (Vite does).
- Merging needs a clean `main`; pushing to GitHub stays a checkbox.
- A merged feature updates its milestone and creates a changelog draft; `scripts/content-hook.sh` copied into `.git/hooks/post-merge` does it on every merge (export `RIPPLE_PROJECT=<project id>`). Accepted automatic fixes ("always do that") live in `out/autofix.json`.
