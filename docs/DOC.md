# Ripple_handoff, la doc

Le [README](../README.md) dit quoi et comment tester. Ici : comment ça marche, page par page, ce que l'API fait, tout ce qu'il faut configurer, et comment développer.

## Sommaire

1. [La boucle](#la-boucle)
2. [Les pages](#les-pages)
3. [L'éditeur d'un post](#léditeur-dun-post)
4. [Comment on se sert de la Meta Model API](#comment-on-se-sert-de-la-meta-model-api)
5. [Le jeu de démo](#le-jeu-de-démo)
6. [Configuration complète](#configuration-complète)
7. [Développer](#développer)
8. [Pipeline dev](#pipeline-dev)

## La boucle

| L'équipe fait seule | Tu décides |
|---|---|
| Un passage par jour quand elle est *on duty* : recherche web, lecture des posts, propositions seulement si rien n'attend ta décision | Oui, non, ou « réécris » sur chaque proposition |
| Les brouillons des pièces acceptées, trois jours avant leur date (*Writer drafts ahead*) | Ce qui est approuvé et quand c'est posté |
| Le rapprochement d'une pièce postée avec le vrai post, et sa lecture une semaine après | Les consignes que tous les agents lisent (« jamais de prix ») |
| Le plan de formats, réécrit après chaque passage | Stop, à tout moment, pendant un passage |

Rien n'est écrit ni posté sans ton clic. Un passage lancé par l'équipe elle-même le dit en première ligne du journal (« On duty: started this pass on its own, nobody asked »). Un passage se coupe d'un bouton : l'appel au modèle en cours est interrompu, les agents restants sont sautés, ce qui était déjà enregistré reste. Un refus se reprend (« Take it back »), et reste dans la chaîne de la pièce. Chaque pièce garde sa chaîne : qui a fait quoi, quand.

Chaque agent laisse sa trace, visible sous son travail et sur sa page :
- **How the Scout worked** : chaque recherche, chaque page ouverte, celles qui l'ont refusé.
- **How the Analyst worked** : les posts lus et leurs dates, les faits calculés sans modèle, la veille prise en compte, tes consignes, le nombre d'appels.
- **How the Strategist worked** : la veille, la lecture de l'Analyst, la feuille de route, ce qui est déjà prévu, les pièces postées et leurs chiffres, tes refus, ton brief, le nombre d'appels, combien de pièces sont sorties.

Ces lignes sont comptées par le serveur avant l'appel, jamais écrites par le modèle.

## Les pages

**Create.** Le premier écran. En tête, ce que l'équipe a fait pendant ton absence (une ligne par agent, badge « on its own, nobody asked » quand elle est passée seule, compte des nouvelles propositions), puis le brief (« What do you want to say, and to whom? »), puis le fil d'un post en cinq colonnes : proposé, en écriture, à relire, prêt à poster, posté. Chaque carte porte le seul bouton qu'elle attend. Tri par date, plus récent ou canal ; filtre par type et par canal ; refusés à reprendre. Une proposition dit la situation, pour qui exactement, la première ligne, le canal, et ce qu'on comptera une semaine après. Une pièce postée retrouve son vrai post (seule sur les premiers mots, proposée et confirmée sur la date) et montre « N days after » : likes, commentaires, partages, vues, face à ce qu'on avait promis de compter. L'onglet du navigateur affiche le nombre de pièces qui t'attendent et qui travaille.

**Platforms.** Une carte par réseau : abonnés, rythme réel sur 16 semaines, ce qu'un post y obtient, la semaine en cours contre l'objectif que tu fixes (posté, prévu, créneaux à remplir, bouton qui demande au Strategist ce qui manque avant dimanche), ce qui est prévu et ce qui a marché, le champ pour coller tes posts ou ton nombre d'abonnés. « Export the approved pieces (ZIP) » : un `posts.csv` et un dossier par pièce (légende, images) pour Buffer, Later ou Business Suite.

**Community.** L'histoire du compte dessinée (un post par barre, les silences grisés et nommés, le meilleur post annoté), puis ce que les posts disent, compté sans modèle (dérive des likes, question ou non, longueur, jour de la semaine, mots du meilleur tiers, portée contre réactions sur LinkedIn), et sous chaque dessin la lecture de l'Analyst : l'action d'abord, l'explication ensuite. Puis le diagnostic et jusqu'à trois correctifs, chacun avec un bouton qui confie le premier pas au Writer.

**Competitors.** Le marché vu par le Scout : une ligne par acteur (qui il est, comment il communique : rythme, formats, sujets, ton, qui parle, ce qu'il demande ; ce qu'il te laisse et la leçon), les dates du public, les posts d'où s'inspirer avec leur lien et « Do our version », et la trace du Scout.

**Calendar.** Les dates du public et tes pièces sur les mêmes jours, trois mois. En tête, les dates sans rien de prévu autour, avec un bouton qui planifie un post cinq jours avant. Glisser une pièce sur un autre jour y verrouille sa date ; les pièces postées ne bougent pas.

**Settings.** Voix, audience, langue du contenu, consignes permanentes, mode de publication (à la main, via un planificateur, via une app Meta), *Team on duty*, *Writer drafts ahead*. Chaque champ dit quel agent le lit.

**Agents.** Une page par agent : marche/arrêt, ressources en parallèle (1 à 3 : plusieurs angles pour le Scout, plusieurs regards pour le Strategist, brouillons en parallèle pour le Writer), comportement écrit avec tes mots, dernier résultat en chiffres, trace, chat. Le Director est le point d'entrée : il propose quoi lancer sous forme de boutons, t'envoie vers l'agent concerné, et résume chaque passage. Le dock « Ask the team » en bas de page route la question vers l'agent qui a le matériel.

Les anciennes pages (Today, Insights, Team, Roadmap) restent accessibles par URL.

**Langue de l'interface.** Anglais ou français, sélecteur en bas de la barre latérale, mémorisé dans le navigateur ; `?lang=fr` dans l'URL force le français une fois. Les noms des agents restent en anglais. La langue du contenu produit, elle, se règle dans *Settings*.

## L'éditeur d'un post

Format (image, carrousel de 2 à 10 slides, vidéo en storyboard), texte, hashtags (nettoyés comme le serveur, 20 max), un descriptif par image ou par plan. Les images sont générées par Muse Image **à ta demande** (bouton par image ou « Generate missing pictures » ; une image est gardée tant que son descriptif ne change pas). « Use my photo » met ta propre image (JPEG, PNG ou WebP, 8 Mo) sur une slide sans appel au modèle. Pour une vidéo, le studio assemble un diaporama local des images clés (zoom lent, texte incrusté, MP4 vertical 720×1280, ffmpeg, aucun token) en attendant que Meta ouvre la génération vidéo. L'aperçu montre le rendu dans un fil. Une pièce approuvée est écrite dans `out/content/<projet>/` ; « Copy caption » copie le texte exact, « Mark posted » enregistre que tu l'as postée.

## Comment on se sert de la Meta Model API

Tout passe par un seul adaptateur, `packages/orchestrator/src/adapters/llm.ts`, sur l'endpoint Responses.

| Agent | Appel | Ce qu'on en tire |
|---|---|---|
| Scout | **Boucle d'outils** : `search` (recherche ancrée) et `open` (page publique lue en texte), jusqu'à 14 appels, `function_call` → exécution → `function_call_output` sur `previous_response_id`, puis réponse en JSON strict | Un passage réel : 45 recherches, 14 pages ouvertes, chiffres et dates lus sur les pages, refus dits tels quels. Sans backend à outils : deux recherches et une condensation |
| Analyst, Strategist, Director | **JSON strict** (`muse-spark-1.3`), schéma zod côté serveur, faits calculés par le serveur et cités au modèle | Lectures qui ne redisent pas les chiffres, propositions avec leur preuve, plan avec ses leviers |
| Writer | JSON strict + **Muse Image** (`muse-image-1.0`) à ta demande ; les images existantes sont renvoyées en entrée lors d'une réécriture | Post complet : format, texte, hashtags, images cohérentes avec le texte |
| Tous | `AbortSignal` passé à chaque fetch et vérifié entre deux tours de la boucle d'outils | Le bouton Stop |

Chaque bouton qui appelle le modèle dit ce que ça coûte et combien de temps ça prend. Un passage du Scout coûte quelques minutes et autant d'appels que d'étapes.

## Le jeu de démo

`pnpm dev:demo` remplit `out/demo/` puis lance l'app dessus sur d'autres ports (orchestrateur 8790, interface 5190), à côté de ton `pnpm dev` habituel ; relance la commande pour repartir d'un jeu identique, `pnpm seed:demo` remplit sans lancer. Le projet « Mairie360 (demo) » contient les 27 vrais posts Instagram de @mairie360 et les 5 vrais posts de sa page LinkedIn (relevés le 2 novembre 2026, `packages/orchestrator/src/demo/account.json`, rien n'est scrapé au lancement), et le vrai travail de l'équipe ce jour-là (`real.json` : audit, veille avec ses liens, lecture de l'Analyst, quatre propositions, plan, note), plus les traces du Analyst et du Strategist recomptées sur ces données. Le dernier passage est marqué comme lancé par l'équipe seule. Seuls l'objectif et les quatre pièces en cours sont écrits à la main.

## Configuration complète

Chaque fonctionnalité qui demande une information de ta part est listée ici. **Quand on en ajoute une, on l'ajoute ici et dans le README.**

### Sur la machine

| Outil | Pour quoi | Obligatoire |
|---|---|---|
| Node 24 | l'orchestrateur (SQLite intégré, TypeScript natif) | oui |
| pnpm 12 | `corepack enable --install-directory ~/.local/bin`, puis `export PATH=$HOME/.local/bin:$PATH` | oui |
| git | branches et copies de travail du pipeline dev | oui |
| ffmpeg avec un encodeur H.264 (`libx264` ou `libopenh264`) | le diaporama local d'un post vidéo : `sudo dnf install ffmpeg` ou `brew install ffmpeg`, vérifie avec `ffmpeg -encoders \| grep 264` | pour la vidéo seulement ; sans lui le bouton affiche l'erreur |
| Google Chrome | le contrôle visuel du pipeline dev | pour le pipeline dev |
| [Muse Code](https://dev.meta.ai/docs/muse-code) (`muse` dans le `PATH`) | le Constructeur du pipeline dev | pour le pipeline dev |
| [GitHub CLI](https://cli.github.com) (`gh auth login`) | créer un dépôt GitHub depuis « From scratch » | pour le pipeline dev |

### Secrets : `.env` à la racine

Copie `.env.example` en `.env`. Le fichier est ignoré par git, ne le commite jamais.

| Variable | Ce que c'est | Où l'obtenir | Obligatoire |
|---|---|---|---|
| `MODEL_API_KEY` | clé de la Meta Model API (Muse Spark, Muse Image, SAM 3.1) | [dev.meta.ai](https://dev.meta.ai) | oui |
| `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN` | lecture du compte Instagram par l'app | ci-dessous | non : sans eux tu colles tes posts sur *Platforms* |
| `FIGMA_TOKEN` | jeton Figma en lecture, depuis le compte dédié au hackathon, fichier partagé en lecture seule | Figma, Settings, Security, Personal access tokens | pour le pipeline dev seulement |

`MODEL_API_KEY` est lue au démarrage : relance `pnpm dev` après l'avoir changée. Les jetons Instagram et Figma sont relus à chaque appel. Variables facultatives : `PORT` (défaut 8787), `JOURNAL_PATH` (`out/journal.db`), `PROJECTS_PATH` (`out/projects.db`), `CONTENT_PATH` (`out/content.db`), `CONTENT_DIR` (`out/content`). `scripts/api-smoke.mjs` vérifie que ta clé Meta répond : `node scripts/api-smoke.mjs`.

### Instagram lu par l'app

1. Le compte Instagram doit être **professionnel** (Créateur ou Entreprise) et **lié à une Page Facebook** (Instagram, Paramètres, Centre de comptes).
2. Crée une app sur [developers.facebook.com](https://developers.facebook.com), type *Entreprise*, ajoute le produit *Instagram Graph API*.
3. Dans l'[Explorateur de l'API Graph](https://developers.facebook.com/tools/explorer), choisis ton app, demande `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, génère un jeton utilisateur.
4. Appelle `me/accounts?fields=instagram_business_account` : le champ `instagram_business_account.id` est ton `INSTAGRAM_USER_ID`.
5. Prolonge le jeton (*Débogueur de jeton d'accès*, « Étendre le jeton », 60 jours) et colle-le dans `INSTAGRAM_ACCESS_TOKEN`.

Avec les deux variables, l'app lit le compte (posts, likes, commentaires, enregistrements, partages, portée, abonnés) à chaque passage et au bouton *Read it now*. Sans jeton, rien n'est lu ni scrapé.

### LinkedIn

LinkedIn n'ouvre pas l'API des pages sans validation de l'app et interdit le scraping. Le chemin : administration de la page, *Analyses*, *Contenu*, *Exporter* ; copie la feuille « Mises à jour » (ou « Updates ») et colle-la dans la carte LinkedIn de *Platforms*. Colonnes reconnues en français ou en anglais (titre, date, impressions, réactions, commentaires, republications), lues à l'exact sans appel au modèle.

## Développer

```bash
pnpm dev          # orchestrateur :8787, interface http://localhost:5173
pnpm test         # node:test, les deux paquets, ~12 s
pnpm typecheck    # doit passer avant tout commit
```

Monorepo pnpm :
- `packages/orchestrator` : Hono, SQLite de Node, zod, TypeScript natif de Node 24. L'équipe dans `src/content/team.ts`, le service des pièces dans `src/content/service.ts`, les routes dans `src/content/routes.ts`, l'adaptateur Meta dans `src/adapters/llm.ts`, le jeu de démo dans `src/demo/`.
- `packages/console` : React 19, Vite 7, routage par hash. Le studio dans `src/studio/`, l'API cliente dans `src/api.ts`, les traductions dans `src/i18n/` (une clé = la phrase anglaise, un fichier par écran).
- `packages/shared`.

Tests : `node:test` + `assert/strict`, co-localisés (`*.test.ts` à côté du source), phrases lisibles qui décrivent le comportement, imports avec extension `.ts`, faux modèle par fichier (`setup()` en tête de chaque test content/team). `pnpm --filter orchestrator test` (~12 s ; les tests lents sont ceux qui creusent git et des dossiers temporaires). La console n'a pas de harnais de composants : `pnpm typecheck` puis vérification sur la démo. Le store pnpm est en lecture seule : aucun paquet ne peut être ajouté.

Pour regarder l'interface sans toucher au serveur déjà lancé : `ORCHESTRATOR_URL=http://localhost:<port> pnpm --filter @ripple/console exec vite --port <autre port>`. Si tu vois `ENETUNREACH`, l'orchestrateur tourne déjà avec `--dns-result-order=ipv4first`.

Tout ce qui est généré va dans `out/` (ignoré par git) : journal, bases, copies de travail (`out/worktrees/`), dépôts clonés (`out/projects/`), captures du contrôle visuel (`out/visual/`), pièces exportées (`out/content/`), démo (`out/demo/`).

L'app Mealkinator est un projet séparé, dans `../mealkinator`.

## Pipeline dev

Masqué de l'interface, intact côté serveur. Le projet a d'abord été une équipe de dev pilotée par Figma : un cadre Figma lié à une feature, planification, construction par Muse Code sur une branche, contrôle visuel de l'app contre le cadre (captures « avant » sur `main` et « après » sur la branche), fusion. Conception dans [DESIGN.md](DESIGN.md).

- Les projets se créent *From GitHub* (URL `https://…` ou `git@…`, cloné dans `out/projects/`), *From scratch* (nom, description, création du dépôt GitHub en case à cocher) ou *Local folder*.
- Une feature : un titre, le lien du cadre Figma (clic droit sur le cadre, Copy link to selection ; taille d'un écran, 200 à 3000 px) ou des notes, et le niveau d'autonomie.
- Le contrôle visuel demande un script `dev` qui accepte `--host`, `--port` et `--strictPort` (Vite le fait).
- La fusion demande `main` propre ; le push vers GitHub reste une case à cocher.
- Une feature fusionnée met à jour son jalon et crée un brouillon de changelog ; `scripts/content-hook.sh` copié dans `.git/hooks/post-merge` le fait à chaque merge (exporte `RIPPLE_PROJECT=<id du projet>`). Les corrections automatiques acceptées (« toujours faire ça ») sont dans `out/autofix.json`.
