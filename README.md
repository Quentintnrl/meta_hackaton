# Ripple_handoff

**Cinq agents qui font la communication d'un petit produit, sur la Meta Model API.**
Ils veillent, lisent tes chiffres, proposent, écrivent, puis relisent ce que ça a donné. Toi, tu dis oui ou non.

![Meta Model API](https://img.shields.io/badge/Meta_Model_API-Responses-0668E1) ![Node 24](https://img.shields.io/badge/Node-24-339933) ![152 tests](https://img.shields.io/badge/tests-152_verts-2ea44f) ![Meta Global AI Developer Hackathon](https://img.shields.io/badge/hackathon-Indie-8b5cf6)

<p align="center"><img src="docs/create.png" alt="Create : ce que l'équipe a fait pendant ton absence, puis le fil d'un post" width="960"></p>

> Ce que montre l'écran : l'équipe est passée seule pendant la nuit (*on its own, nobody asked*), quatre propositions attendent, et chaque pièce avance sur le fil d'un post avec le seul bouton qu'elle attend.

## La boucle

```mermaid
flowchart LR
  S([🔍 Scout<br/>veille le terrain]) --> A([📈 Analyst<br/>lit ton compte])
  A --> T([🧭 Strategist<br/>propose])
  T -- tu dis oui --> W([🖋 Writer<br/>écrit, dessine])
  W -- tu approuves --> P[(posté)]
  P -- une semaine après --> A
  D([★ Director<br/>planifie, résume]) -.-> S
  D -.-> T
```

| L'équipe fait seule | Tu décides |
|---|---|
| Un passage par jour quand elle est *on duty* : recherche web, lecture des posts, propositions | Oui, non, ou « réécris » sur chaque proposition |
| Les brouillons des pièces acceptées, trois jours avant leur date | Ce qui est approuvé et quand c'est posté |
| Le rapprochement d'une pièce postée avec le vrai post, et sa lecture une semaine après | Les consignes que tous les agents lisent (« jamais de prix ») |
| Le plan de formats, réécrit après chaque passage | Stop, à tout moment, pendant un passage |

Rien n'est écrit ni posté sans ton clic. Un passage se coupe d'un bouton, un refus se reprend, chaque pièce garde sa chaîne (qui a fait quoi, quand), et chaque agent laisse sa trace : « How the Scout worked » (recherches, pages ouvertes), « How the Analyst worked » et « How the Strategist worked » (ce qu'ils ont lu avant d'appeler le modèle, compté par le serveur).

## Comment on se sert de la Meta Model API

| Agent | Appel | Ce qu'on en tire |
|---|---|---|
| Scout | **Boucle d'outils** de la Responses API : `search` (recherche ancrée) et `open` (page publique lue en texte), jusqu'à 14 appels, `previous_response_id` | Un passage réel : 45 recherches, 14 pages ouvertes, chiffres et dates lus sur les pages, refus dits tels quels |
| Analyst, Strategist, Director | **JSON strict** (`muse-spark`), schéma zod côté serveur, chiffres calculés par le serveur jamais par le modèle | Lectures qui ne redisent pas les chiffres, propositions avec leur preuve |
| Writer | JSON strict + **Muse Image** (`muse-image-1.0`) à ta demande, une image par slide | Post complet : format, texte, hashtags, images |
| Tous | `AbortSignal` passé à chaque appel | Le bouton Stop coupe l'appel en cours |

La vidéo n'est pas encore ouverte côté Meta : le studio monte un diaporama local des images clés (ffmpeg, aucun token). Dès que l'API l'ouvre, la case est prête.

## Voir tourner en deux minutes

```bash
export PATH=$HOME/.local/bin:$PATH
pnpm install
cp .env.example .env     # mets ta clé MODEL_API_KEY
pnpm dev:demo            # http://localhost:5190
```

`dev:demo` remplit `out/demo/` avec le projet **Mairie360 (demo)** : 27 vrais posts Instagram et 5 vrais posts LinkedIn de @mairie360 (relevés le 2 novembre 2026, `packages/orchestrator/src/demo/account.json`), et un vrai passage de l'équipe sauvegardé ce jour-là (`real.json` : audit, veille avec ses liens, lecture, quatre propositions, plan, note). Tout se parcourt **sans appel au modèle** ; *Propose*, *Yes, write it* ou *Generate picture* en feront de vrais, chaque bouton dit sa durée. Il tourne sur d'autres ports (8790, 5190), à côté de ton `pnpm dev` habituel.

## Les pages

| Page | Ce qu'on y fait |
|---|---|
| **Create** | Ce que l'équipe a fait pendant ton absence, le brief, puis le fil d'un post en cinq étapes : proposé, en écriture, à relire, prêt, posté. Tri, filtre, refusés à reprendre. La carte « une semaine après » compare promis et obtenu. |
| **Platforms** | Une carte par réseau : abonnés, rythme réel, semaine en cours contre ton objectif, bouton qui demande au Strategist ce qui manque. Export ZIP des pièces approuvées pour Buffer, Later ou Business Suite. |
| **Community** | L'histoire du compte dessinée, les silences nommés, et sous chaque dessin la lecture de l'Analyst : la chose à changer, puis ce que le chiffre veut dire. |
| **Competitors** | Le marché vu par le Scout : une ligne par acteur (qui, comment il communique, ce qu'il te laisse), les dates du public, les posts d'où s'inspirer, et « How the Scout worked ». |
| **Calendar** | Dates du public et pièces sur les mêmes jours, trois mois. Glisser une pièce sur un jour y verrouille sa date. |
| **Settings** | Voix, audience, consignes, mode de publication, *Team on duty*, *Writer drafts ahead*. Chaque champ dit quel agent le lit. |
| **Agents** | Une page par agent : marche/arrêt, ressources en parallèle, comportement avec tes mots, dernier résultat, chat. Le Director est le point d'entrée. |

Dans l'éditeur d'un post : format (image, carrousel, vidéo), texte, hashtags, images générées ou **tes propres photos** (« Use my photo », sans appel modèle), aperçu dans un fil, *Copy caption*, *Mark posted*. Une pièce approuvée est écrite dans `out/content/<projet>/`.

## Ce que tu dois fournir

Chaque fonctionnalité qui a besoin d'une information de ta part est listée ici. **Quand on en ajoute une, on l'ajoute à cette section.**

| Outil | Pour quoi | Obligatoire |
|---|---|---|
| Node 24 | l'orchestrateur (SQLite intégré, TypeScript natif) | oui |
| pnpm 12 | `corepack enable --install-directory ~/.local/bin`, puis `export PATH=$HOME/.local/bin:$PATH` | oui |
| git | branches et copies de travail du pipeline dev | oui |
| ffmpeg (encodeur H.264) | le diaporama local d'un post vidéo : `sudo dnf install ffmpeg` ou `brew install ffmpeg` | pour la vidéo seulement |
| Google Chrome | le contrôle visuel du pipeline dev | pour le pipeline dev |
| [Muse Code](https://dev.meta.ai/docs/muse-code) (`muse`), [GitHub CLI](https://cli.github.com) | le pipeline dev (Constructeur, dépôt créé depuis « From scratch ») | pour le pipeline dev |

Secrets dans `.env` à la racine (copie `.env.example`, jamais commité) :

| Variable | Ce que c'est | Où l'obtenir | Obligatoire |
|---|---|---|---|
| `MODEL_API_KEY` | clé de la Meta Model API (Muse Spark, Muse Image, SAM 3.1) | [dev.meta.ai](https://dev.meta.ai) | oui |
| `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN` | lecture du compte Instagram par l'app (posts, likes, portée, abonnés) | voir ci-dessous | non : sans eux, tu colles tes posts sur *Platforms* |
| `FIGMA_TOKEN` | jeton Figma en lecture, depuis le compte dédié au hackathon, fichier partagé en lecture seule | Figma, Settings, Security | pour le pipeline dev seulement |

`MODEL_API_KEY` est lue au démarrage (relance `pnpm dev` après l'avoir changée). Les jetons Instagram et Figma sont relus à chaque appel. Variables facultatives : `PORT` (8787), `JOURNAL_PATH`, `PROJECTS_PATH`, `CONTENT_PATH` (dans `out/`), `CONTENT_DIR`.

<details>
<summary><b>Instagram lu par l'app</b> : obtenir les deux variables</summary>

1. Le compte Instagram doit être **professionnel** (Créateur ou Entreprise) et **lié à une Page Facebook** (Instagram, Paramètres, Centre de comptes).
2. Crée une app sur [developers.facebook.com](https://developers.facebook.com), type *Entreprise*, ajoute le produit *Instagram Graph API*.
3. Dans l'[Explorateur de l'API Graph](https://developers.facebook.com/tools/explorer), choisis ton app, demande `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, génère un jeton utilisateur.
4. Appelle `me/accounts?fields=instagram_business_account` : le champ `instagram_business_account.id` est ton `INSTAGRAM_USER_ID`.
5. Prolonge le jeton (*Débogueur de jeton d'accès*, « Étendre le jeton », 60 jours) et colle-le dans `INSTAGRAM_ACCESS_TOKEN`.

Rien n'est scrapé : sans jeton, rien n'est lu. Avec, le compte est relu à chaque passage et au bouton *Read it now*.
</details>

<details>
<summary><b>LinkedIn</b> : l'export de la page</summary>

LinkedIn n'ouvre pas l'API des pages sans validation de l'app et interdit le scraping. Le chemin : administration de la page, *Analyses*, *Contenu*, *Exporter* ; copie la feuille « Mises à jour » (ou « Updates ») et colle-la dans la carte LinkedIn de *Platforms*. Colonnes reconnues en français ou en anglais, lues à l'exact sans appel au modèle.
</details>

<details>
<summary><b>Pipeline dev</b> (masqué de l'interface, intact côté serveur)</summary>

Le projet a d'abord été une équipe de dev pilotée par Figma : un cadre Figma lié à une feature, planification, construction par Muse Code sur une branche, contrôle visuel contre le cadre, fusion. Conception dans [docs/DESIGN.md](docs/DESIGN.md). Les projets se créent *From GitHub*, *From scratch* ou *Local folder* ; le contrôle visuel demande un script `dev` qui accepte `--host`, `--port`, `--strictPort`. Le push vers GitHub reste une case à cocher. Une feature fusionnée crée un brouillon de changelog ; `scripts/content-hook.sh` dans `.git/hooks/post-merge` le fait à chaque merge (`RIPPLE_PROJECT=<id>`).
</details>

## Développer

```bash
pnpm dev          # orchestrateur :8787, interface http://localhost:5173
pnpm test         # node:test, les deux paquets, ~12 s
pnpm typecheck    # doit passer avant tout commit
node scripts/api-smoke.mjs   # vérifie que ta clé Meta répond
```

Monorepo pnpm : `packages/orchestrator` (Hono, SQLite de Node, zod ; l'équipe dans `src/content/team.ts`, l'adaptateur Meta dans `src/adapters/llm.ts`), `packages/console` (React, Vite ; le studio dans `src/studio/`), `packages/shared`. Les tests sont à côté du source (`*.test.ts`), avec un faux modèle par fichier ; la console n'a pas de harnais de composants, on vérifie sur la démo. Tout ce qui est généré va dans `out/` (ignoré par git). Si tu vois `ENETUNREACH`, l'orchestrateur tourne déjà avec `--dns-result-order=ipv4first`.

L'app Mealkinator est un projet séparé, dans `../mealkinator`.
