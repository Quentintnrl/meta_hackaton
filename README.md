# Ripple_handoff

Équipe d'agents pilotée par le design, pour le Meta Global AI Developer Hackathon (piste Indie).
Tu relies un cadre Figma à un projet : les agents planifient, construisent, vérifient le résultat contre le cadre,
puis fusionnent. Conception : [docs/DESIGN.md](docs/DESIGN.md).

L'app de démo, Mealkinator, est un projet séparé dans `../mealkinator`.

## Ce que tu dois fournir

Chaque fonctionnalité qui a besoin d'une information de ta part est listée ici. **Quand on en ajoute une, on l'ajoute à cette section.**

### Prérequis sur la machine

| Outil | Pour quoi | Obligatoire |
|---|---|---|
| Node 24 | l'orchestrateur (SQLite intégré, TypeScript natif) | oui |
| pnpm 12 | `corepack enable --install-directory ~/.local/bin`, puis `export PATH=$HOME/.local/bin:$PATH` | oui |
| git | branches, copies de travail, fusion | oui |
| [Muse Code](https://dev.meta.ai/docs/muse-code) (`muse` dans le `PATH`) | le Constructeur : écrit la feature sur une branche | oui |
| Google Chrome | le contrôle visuel capture l'app avec ton Chrome (aucun téléchargement) | pour le contrôle visuel |
| [GitHub CLI](https://cli.github.com) (`gh auth login`) | créer un dépôt GitHub depuis « From scratch » | seulement si tu coches cette option |

### Secrets : fichier `.env` à la racine

Copie `.env.example` en `.env` et remplis-le. Le fichier est ignoré par git, ne le commite jamais.

| Variable | Ce que c'est | Où l'obtenir | Obligatoire |
|---|---|---|---|
| `MODEL_API_KEY` | clé de la Meta Model API (Muse Spark, SAM 3.1, Muse Image) | [dev.meta.ai](https://dev.meta.ai) | oui |
| `FIGMA_TOKEN` | jeton d'accès personnel Figma, en lecture | Figma, Settings, Security, Personal access tokens (portée : lecture du contenu des fichiers) | pour lier un cadre Figma à une feature |

Pour `FIGMA_TOKEN`, utilise le compte Figma **dédié au hackathon** et partage-lui le fichier du projet en **lecture seule** :
le jeton ne verra que ce fichier. `FIGMA_TOKEN` est relu à chaque appel : pas besoin de redémarrer. Les autres variables (`MODEL_API_KEY`, chemins, port) ne sont lues qu'au démarrage : redémarre `pnpm dev` (Ctrl+C, puis relance) après les avoir changées.

Variables facultatives : `PORT` (défaut `8787`), `JOURNAL_PATH` (défaut `out/journal.db`), `PROJECTS_PATH` (défaut `out/projects.db`), `CONTENT_PATH` (défaut `out/content.db`, feuille de route et contenu). Les corrections automatiques que tu acceptes (« toujours faire ça ») sont dans `out/autofix.json` ; tu peux les retirer depuis la page du projet.

### Dans l'interface

- **Ajouter un projet** : trois sources.
  - *From GitHub* : l'URL d'un dépôt (`https://…` ou `git@…`). Il est cloné dans `out/projects/`. Un dépôt privé demande que ta machine puisse déjà le cloner (clé SSH ou `gh auth login`).
  - *From scratch* : un nom et une description. La création d'un dépôt GitHub est une case à cocher, décochée par défaut.
  - *Local folder* : le chemin d'un dépôt déjà présent sur ta machine.
- **Nouvelle feature** : un titre, le **lien du cadre Figma** (clic droit sur le cadre, Copy/Paste as, Copy link to selection) ou des notes, et le niveau d'autonomie. Le cadre doit avoir la taille d'un écran (200 à 3000 px).
- **Fusion** : le dépôt doit être sur `main` et sans modification en cours. Le push vers GitHub est une case à cocher à chaque fusion, jamais automatique.
- **Contrôle visuel et « avant / après »** : le projet doit avoir un script `dev` qui démarre un serveur acceptant `--host`, `--port` et `--strictPort` (Vite le fait). L'app est capturée deux fois : sur `main` avant la feature (« avant »), puis sur la branche construite (« après »). Un projet sans ce script n'aura pas de captures, mais la construction continue.

### Jeu de données de démo

`pnpm dev:demo` remplit `out/demo/` puis lance l'app dessus **sur d'autres ports** (orchestrateur 8790, interface **http://localhost:5190**), donc à côté de ton `pnpm dev` habituel sans l'arrêter (tes vraies données ne sont pas touchées ; relance la commande pour repartir d'un jeu identique, `pnpm seed:demo` seul remplit sans lancer). Il contient un projet fictif « Mealkinator (demo) » : 4 features (3 fusionnées, 1 prête à fusionner), 3 jalons (un terminé en retard, qui a appris à l'IA le coefficient x1,3 ; un en glissement ; un lointain) avec l'historique des projections, un audit du Scout, un compte de démo (étiqueté fictif), et du contenu à tous les stades : 4 propositions à trancher, 1 refus avec sa raison, un carrousel avec 2 images, une vidéo en storyboard, un post approuvé, un publié, des changelogs, des briefs. Aucun appel au modèle n'est nécessaire pour le parcourir ; « Brief the team » ou « Generate picture » en feront, eux, de vrais.

### Studio de communication

Entrée **Communication studio** de chaque projet : une petite équipe d'agents que tu diriges. Un sous-menu à gauche, une page à la fois : **Inbox** (ce qui attend ta décision : le brief, les propositions, les brouillons à relire ; un pas-à-pas guide le premier lancement), **Plan** (Calendar, Roadmap), **Research** (The field, Your account), **Team** (Agents & activity, Orders & voice). Rien de plus à configurer que `MODEL_API_KEY`.

- **Scout** : cherche sur le web ce qui marche dans ton domaine (formats, accroches, sujets), sources à l'appui.
- **Analyst** : compare ton compte à ce que le Scout a trouvé. Il lui faut tes posts : colle-les avec leurs chiffres (onglet *Orders & account*, n'importe quel format, le modèle les structure et n'invente aucun chiffre) ou charge le **compte de démo** (posts fictifs, toujours étiquetés « Demo data »). Il n'y a pas encore de connexion directe à Instagram Insights.
- **Strategist** : lit l'audit, l'analyse de ton compte **et la feuille de route de dev** (jalons, features en cours, derniers commits), puis propose du contenu, chaque proposition avec sa raison (tendance, compte ou roadmap).
- **Writer** : rédige ce que tu acceptes. Un **post** (post, teaser) est un paquet complet : le **format** (image, carrousel de 3 à 8 images, ou vidéo), la **description**, les **#hashtags**, et un descriptif par image ou par plan. Les images sont générées par Muse Image **à ta demande** (bouton par image, ou « Generate missing pictures » : chaque image est un appel payant, rien n'est dessiné dans ton dos ; une image est gardée tant que son descriptif ne change pas). Pour une **vidéo**, l'équipe écrit le storyboard (plans, durées, voix off) et des images clés ; la vidéo elle-même n'est pas générée, c'est à toi de la tourner ou la monter. L'aperçu montre le rendu dans un fil.
- **Toi, le manager** : tu briefes l'équipe en une phrase, tu acceptes, acceptes et fais écrire, ou refuses en donnant la raison. Les refus sont relus par le Strategist au tour suivant et un titre refusé ne revient pas. Les *standing orders* (« jamais de prix », « 2 posts par semaine ») sont lus par tous les agents.
- **Calendrier** (vue mois) et **Roadmap** (frise : ta date, la date projetée, le contenu). La date projetée d'un jalon est calculée à partir du rythme réel, révisée à chaque fusion et chaque jour, et corrigée par l'écart mesuré sur les jalons terminés ; chaque projection est gardée avec une note. Les dates du contenu suivent la projection (badge `+3d`) ; verrouille une date pour la figer.
- **Dans le flux de dev** : une feature fusionnée met à jour son jalon et crée un brouillon de changelog. « Changelog from git » écrit depuis l'historique ; `scripts/content-hook.sh` copié dans `.git/hooks/post-merge` le fait à chaque merge (exporte `RIPPLE_PROJECT=<id du projet>`).
- Une pièce approuvée est écrite dans `out/content/<projet>/` (texte, hashtags, plans et images copiées à côté). `CONTENT_DIR` change ce dossier. « Mark published » ne publie nulle part pour l'instant.
- Pour regarder l'interface sans toucher au serveur déjà lancé : `ORCHESTRATOR_URL=http://localhost:<port> pnpm --filter @ripple/console exec vite --port <autre port>`.

## Lancer

```bash
export PATH=$HOME/.local/bin:$PATH
pnpm install
pnpm dev          # orchestrateur sur :8787, interface sur http://localhost:5173
pnpm test
pnpm typecheck
```

Si tu vois `ENETUNREACH` (IPv6 indisponible), l'orchestrateur est déjà lancé avec `--dns-result-order=ipv4first`.

`scripts/api-smoke.mjs` vérifie que ta clé Meta marche (`node scripts/api-smoke.mjs`).

## Où vont les fichiers

Tout ce qui est généré est dans `out/` (ignoré par git) : journal, base des projets, copies de travail des branches
(`out/worktrees/<projet>/<feature>`), dépôts clonés ou créés (`out/projects/`), captures et rapports du contrôle visuel (`out/visual/`).
