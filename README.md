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
| `INSTAGRAM_USER_ID` | identifiant du compte Instagram professionnel | voir « Compte Instagram lu par l'app » ci-dessous | pour que l'app lise Instagram seule |
| `INSTAGRAM_ACCESS_TOKEN` | jeton d'accès à l'API Instagram Graph (Meta) | idem | idem |

**Vidéo (optionnel).** Meta n'expose pas encore de modèle de génération vidéo sur son API (Muse Video est annoncé, pas appelable). Le Studio monte donc la vidéo d'un post lui-même : bouton *Assemble the video* dans l'éditeur, à partir des images clés (chacune tenue ses secondes, zoom lent, texte incrusté), en MP4 vertical 720×1280. Il tourne en local avec `ffmpeg` : **aucun appel au modèle, donc aucun token** (seules les images clés coûtent, une génération chacune, et seulement à ta demande). Il faut `ffmpeg` avec un encodeur H.264 (`libx264` ou `libopenh264`) : `sudo dnf install ffmpeg` (Fedora, vérifie l'encodeur avec `ffmpeg -encoders | grep 264`) ou `brew install ffmpeg`. Sans lui, le reste fonctionne et le bouton affiche l'erreur.

Pour `FIGMA_TOKEN`, utilise le compte Figma **dédié au hackathon** et partage-lui le fichier du projet en **lecture seule** :
le jeton ne verra que ce fichier. `FIGMA_TOKEN` est relu à chaque appel : pas besoin de redémarrer. Les autres variables (`MODEL_API_KEY`, chemins, port) ne sont lues qu'au démarrage : redémarre `pnpm dev` (Ctrl+C, puis relance) après les avoir changées.

**Compte Instagram lu par l'app (optionnel).** Avec `INSTAGRAM_USER_ID` et `INSTAGRAM_ACCESS_TOKEN`, l'app lit le compte elle-même : posts, likes, commentaires, enregistrements, partages, portée et abonnés, à chaque passage de l'équipe (et au bouton *Read it now* de la carte Instagram). Sans eux, la carte garde sa zone de collage. Pour les obtenir : 1) le compte Instagram doit être **professionnel** (Créateur ou Entreprise) et **lié à une Page Facebook** (Instagram, Paramètres, Centre de comptes) ; 2) crée une app sur [developers.facebook.com](https://developers.facebook.com), type *Entreprise*, et ajoute-lui le produit *Instagram Graph API* ; 3) dans l'[Explorateur de l'API Graph](https://developers.facebook.com/tools/explorer), choisis ton app, demande les autorisations `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, génère un jeton utilisateur ; 4) toujours dans l'explorateur, appelle `me/accounts?fields=instagram_business_account` : le champ `instagram_business_account.id` est ton `INSTAGRAM_USER_ID` ; 5) prolonge le jeton (outil *Débogueur de jeton d'accès*, « Étendre le jeton », 60 jours) et colle-le dans `INSTAGRAM_ACCESS_TOKEN`. Les deux variables sont relues à chaque lecture : pas besoin de redémarrer. Rien n'est scrapé : sans jeton, rien n'est lu.

**Page LinkedIn (export).** LinkedIn n'ouvre pas l'API des pages sans validation de l'app, et le scraping est interdit par ses conditions. Le chemin : administration de la page, *Analyses*, *Contenu*, *Exporter* ; ouvre le fichier, copie la feuille « Mises à jour » (ou « Updates ») et colle-la dans la carte LinkedIn de *Platforms*. Les colonnes sont reconnues en français ou en anglais (titre, date, impressions, réactions, commentaires, republications), lues à l'exact sans appel au modèle.

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

`pnpm dev:demo` remplit `out/demo/` puis lance l'app dessus **sur d'autres ports** (orchestrateur 8790, interface **http://localhost:5190**), donc à côté de ton `pnpm dev` habituel sans l'arrêter (tes vraies données ne sont pas touchées ; relance la commande pour repartir d'un jeu identique, `pnpm seed:demo` seul remplit sans lancer). Il contient le projet « Mairie360 (demo) » : les 27 vrais posts Instagram de @mairie360 (texte, date, likes, relevés le 2 novembre 2026 ; partages et enregistrements absents de la page publique, donc à 0) et les 5 vrais posts de la page LinkedIn (texte, date, réactions, republications et impressions lus dans l'admin de la page le même jour, 8 abonnés), tous deux dans `packages/orchestrator/src/demo/account.json` (rien n'est scrapé au lancement : ce fichier est lu par le seed), et le travail réel de l'équipe produit ce jour-là et sauvegardé dans `packages/orchestrator/src/demo/real.json` : l'audit du terrain et la veille des acteurs comparables (recherche web, 11 trouvailles avec leurs liens, 5 dates), la lecture de l'Analyst, 4 propositions du Strategist, le plan et la note du Director. Seuls les dates de l'objectif et les 4 contenus en cours (carrousel avec 2 images, post approuvé, devlog, lettre) sont écrits à la main. Aucun appel au modèle n'est nécessaire pour le parcourir ; « Brief the team » ou « Generate picture » en feront, eux, de vrais.

### Studio de communication

Chaque projet ouvre directement sur son **studio** : une petite équipe de communication qui travaille en continu, et quatre tableaux pour la suivre. **Create** : ce que l'équipe propose (la situation que la pièce répond, pour qui exactement, la première ligne du post, le canal, pourquoi, et ce qu'on comptera une semaine après), puis chaque pièce acceptée avec ses quatre étapes (acceptée, écrite, approuvée, postée), l'étape en cours allumée et le seul bouton qu'elle attend. **Platforms** : une carte par plateforme (Instagram, LinkedIn…) avec ses abonnés, son rythme réel sur 16 semaines, ce qu'un post y obtient (likes, ou réactions et vues sur LinkedIn), ce qui y est prévu, et le champ pour y coller ses posts ou juste son nombre d'abonnés. **Community** : les réactions post par post dans le temps (une couleur par plateforme), les abonnés par plateforme (une courbe dès deux relevés), puis ce que les chiffres disent et quoi faire : le silence dit tel quel, le diagnostic de l'Analyst et jusqu'à trois correctifs (problème, solution, premier pas), chacun avec un bouton qui confie le premier pas au Writer ; enfin les trois posts les plus aimés avec la lecture de l'Analyst sur chacun. **Competitors** : le marché tel que le Scout le voit après une recherche web ; une fiche par acteur comparable (sa place dans le marché, sa taille en chiffres, à qui il parle, où et quoi il publie, sa force, ce qu'il te laisse) ; le calendrier de ton public (chaque date avec ce que les gens y font et quoi poster avant, avec un bouton pour planifier le post) ; et les posts d'où s'inspirer, avec l'image de la page, le chiffre, ce qu'on en prendrait et le lien ; « Do our version » confie un brief au Writer. *Settings* garde la voix, les consignes, le mode de publication et l'interrupteur **Team on duty**, chaque champ disant quel agent le lit et ce qui change : quand il est allumé, l'équipe fait un passage seule environ une fois par jour (veille, compte, propositions seulement si rien n'attend ta décision) ; elle n'écrit ni ne poste jamais sans toi. Les anciennes pages (Today, Calendar, Insights, Team) restent accessibles par URL. Rien de plus à configurer que `MODEL_API_KEY` ; avec le jeton Instagram en plus, la carte Instagram se remplit seule. (Le pipeline dev — features, branches, checks visuels — est masqué de l'interface mais intact côté serveur et dans git.)

**Gérer l'équipe.** Le **Director** est l'agent parent : on lui parle en premier (« que fait-on cette semaine ? »). Il propose quoi lancer ou régler sous forme de boutons (rien ne part sans ton clic), t'envoie vers l'agent concerné quand il faut lui parler directement, et résume le travail de l'équipe après chaque passage (carte *Director's note* dans l'Inbox). Chaque agent a sa page : interrupteur marche/arrêt, **nombre de ressources en parallèle (1 à 3)** (Scout : plusieurs angles de recherche ; Strategist : plusieurs regards roadmap / compte / tendances ; Writer : brouillons en parallèle), **comportement** écrit avec tes mots (injecté dans ses consignes), dernier résultat en chiffres, et chat pour changer son comportement (il propose la nouvelle consigne, tu l'appliques). Plus il y a de ressources, plus il y a d'appels au modèle.

**Des chiffres, pas que du texte.** La page *Insights* met les nombres en premier. Le **plan** du Director : un mix de formats pour les semaines à venir, chaque ligne avec son nombre de pièces, son levier (*Double down*, *Fill the gap*, *Test*, *Keep*), ta moyenne sur ce format (rang parmi tes formats) et le chiffre mesuré dans le terrain, source à l'appui ; il est réécrit à chaque passage de l'équipe, ou à la demande (*Redo the plan*). Le tableau **You vs the field** : ta cadence de publication face au repère du terrain, puis format par format ta moyenne, la mesure du terrain et le levier du plan (unités différentes, dites comme telles). Le Scout cherche des **chiffres mesurés** (taux d'engagement, saves, vues, fréquence de publication, durée idéale) avec leur source et leur période ; quand la recherche n'en donne pas, la fiche dit « no figure found » plutôt qu'inventer. Les exemples ont leur lien, leur propre chiffre (« 12k saves ») et une **vignette** récupérée depuis la page (une fois, en local, sans appel modèle ; adresses publiques seulement). Chaque idée dans *Today* montre **ses chiffres** : où son format se place parmi tes formats (barres) et le chiffre du terrain qu'elle s'appuie dessus — calculés par le serveur à partir des stats, jamais écrits par le modèle.

- **Scout** : veille sur le web ce qui marche dans ton domaine (formats, accroches, sujets), avec les chiffres mesurés et leurs sources, sources à l'appui — et ce qui rate, avec un exemple vu sur le terrain pour chaque flop. Chaque passage est gardé : le journal de veille montre la recherche précédente.
- **Analyst** : compare ton compte à ce que le Scout a trouvé, avec ton podium (3 meilleurs posts) et tes flops (3 plus faibles), chiffres exacts et une ligne d'explication chacun. Il lui faut tes posts : colle-les avec leurs chiffres (espace *Insights*, onglet *Your account*, texte libre ou tableau CSV `text,likes,…` repris à l'exact sans appel au modèle) ou charge le **compte de démo** (posts fictifs, toujours étiquetés « Demo data »). Avec `INSTAGRAM_USER_ID` et `INSTAGRAM_ACCESS_TOKEN` dans `.env`, il lit Instagram tout seul (voir la section Secrets).
- **Strategist** : lit l'audit, l'analyse de ton compte **et la feuille de route de dev** (jalons, features en cours, derniers commits), puis propose du contenu, chaque proposition avec sa raison (tendance, compte ou roadmap) et sa preuve chiffrée (badge « Proven by »).
- **Writer** : rédige ce que tu acceptes. Un **post** (post, teaser) est un paquet complet : le **format** (image, carrousel de 3 à 8 images, ou vidéo), la **description**, les **#hashtags**, et un descriptif par image ou par plan. Les images sont générées par Muse Image **à ta demande** (bouton par image, ou « Generate missing pictures » : chaque image est un appel payant, rien n'est dessiné dans ton dos ; une image est gardée tant que son descriptif ne change pas). Pour une **vidéo**, l'équipe écrit le storyboard (plans, durées, voix off) et des images clés ; la vidéo elle-même n'est pas générée, c'est à toi de la tourner ou la monter. L'aperçu montre le rendu dans un fil.
- **Toi, le manager** : tu briefes l'équipe en une phrase, tu acceptes, acceptes et fais écrire, ou refuses en donnant la raison. Les refus sont relus par le Strategist au tour suivant et un titre refusé ne revient pas. Les *standing orders* (« jamais de prix », « 2 posts par semaine ») sont lus par tous les agents.
- **Calendrier** (vue mois) et **Roadmap** (frise : ta date, la date projetée, le contenu). La date projetée d'un jalon est calculée à partir du rythme réel, révisée à chaque fusion et chaque jour, et corrigée par l'écart mesuré sur les jalons terminés ; chaque projection est gardée avec une note. Les dates du contenu suivent la projection (badge `+3d`) ; verrouille une date pour la figer.
- **Dans le flux de dev** : une feature fusionnée met à jour son jalon et crée un brouillon de changelog. « Changelog from git » écrit depuis l'historique ; `scripts/content-hook.sh` copié dans `.git/hooks/post-merge` le fait à chaque merge (exporte `RIPPLE_PROJECT=<id du projet>`).
- Une pièce approuvée est écrite dans `out/content/<projet>/` (texte, hashtags, plans et images copiées à côté). `CONTENT_DIR` change ce dossier. Pour la sortir, « Copy caption » copie le texte exact à coller (description + hashtags), puis « Mark posted » enregistre que tu l'as postée à la main : aucune app Meta requise. Le mode de sortie se règle par projet (réglages du studio) : *local* (à la main, défaut), *assisté* (à la main via un planificateur type Buffer, Later ou Business Suite), *connecté* (publication via l'app Meta configurée, échoue explicitement sinon). Tes chiffres se collent en texte libre ou en tableau CSV (`text,likes,…`, repris à l'exact sans appel au modèle).
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

## Contribuer : où mettre un test

- Stack de test : `node:test` + `assert/strict`, co-localisé (`*.test.ts` à côté du source), phrases lisibles qui décrivent le comportement. Imports avec extension `.ts`. Faux LLM par fichier (`setup()` en tête de chaque test content/team).
- Orchestrateur : `pnpm --filter orchestrator test` (~12 s). Les tests lents sont ceux qui creusent git, worktrees et tmp (`builder`, `integrator`, `recovery`, `clone`) : ~200 ms à 8 s chacun, ils font l'essentiel du temps total. Le reste est instantané.
- Console : `pnpm --filter console test` — uniquement les helpers purs sans React (`route-path.test.ts`, URLs par sous-page). Pas de harnais pour les composants : on vérifie par `pnpm typecheck` + test manuel sur la démo (`http://localhost:5190`, données `simulated`). `src/node-test.d.ts` remplace `@types/node` (store pnpm en lecture seule : aucun paquet ne peut être ajouté).
- `pnpm test` à la racine lance les deux. `pnpm typecheck` doit passer avant tout commit.

## Où vont les fichiers

Tout ce qui est généré est dans `out/` (ignoré par git) : journal, base des projets, copies de travail des branches
(`out/worktrees/<projet>/<feature>`), dépôts clonés ou créés (`out/projects/`), captures et rapports du contrôle visuel (`out/visual/`).
