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

### Contenu et feuille de route

Onglet **Content & roadmap** de chaque projet. Rien à installer ni à configurer en plus de `MODEL_API_KEY`.

- **Voix et public** : à remplir une fois (ton, lecteurs, langue). L'IA écrit avec. La case « rédiger toute seule » fait rédiger les pièces dont la date approche (3 jours avant) ; elle n'approuve ni ne publie jamais.
- **Jalons** : un titre, ta phrase de ce que tu veux, une date cible, le nombre de features que ça prend. Rattache-y des features. L'IA projette la date d'arrivée, la **révise** à chaque fusion (et chaque jour), garde l'historique de ses projections, et se **corrige** : à chaque jalon terminé, l'écart entre ses projections et la réalité ajuste les suivantes.
- **Calendrier** : « Plan content with AI » propose des pièces autour d'un jalon (teasers, changelog, démo…), tu corriges les briefs, elle rédige, tu demandes des changements, tu approuves. Les dates des pièces suivent la projection du jalon (badge `+Nd`) ; verrouille une date pour la figer. Une pièce approuvée est écrite dans `out/content/<projet>/`. « Mark published » ne publie nulle part : la publication Instagram reste la porte `publish`.
- **Dans le flux de dev** : une feature fusionnée crée seule un brouillon de changelog et met à jour son jalon. « Changelog from git » écrit un changelog depuis l'historique du dépôt. Pour le déclencher à chaque merge, copie `scripts/content-hook.sh` dans `.git/hooks/post-merge` du projet et exporte `RIPPLE_PROJECT=<id du projet>` (et `RIPPLE_PORT` si tu changes le port).

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
