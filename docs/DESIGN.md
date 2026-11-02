# Ripple_handoff — design

Projet du Meta Global AI Developer Hackathon, piste **Indie** (solo). Rendu : 4 novembre 2026, 21h (heure de l'Est).
Statut : implémenté (pipeline dev + communication studio). Ce document reste la conception d'origine : en cas de doute, le code fait foi.

L'app de démo (Mealkinator) est un projet séparé : voir `../mealkinator`. Ce document ne décrit que Ripple_handoff.

## 1. Concept
Une équipe d'agents pour la personne qui lance un projet avec **une seule compétence** (technique ou communication)
et n'a ni le temps ni l'énergie de tout faire. Le **design Figma est la source de vérité** : l'utilisateur
modifie sa maquette, les agents se déclenchent entre eux pour planifier, construire, vérifier, communiquer et
retourner un avis. L'objectif du hackathon est de **montrer que ce cycle est automatisable**.

Thèmes visés : « Build for Your World » (besoin vécu : un projet d'étude qui exige produit, com, design,
retours et recette), et « Push the Frontier » (logiciel).

## 2. L'unité de travail : la feature
Chaque feature suit une machine à états, avec une branche parallèle de communication.

```
DESIGN_DEFINED (maquette Figma)
  -> PLANNED (plan d'implémentation + options techniques)            [porte : validation du plan]
       ├─ branche dev
       │    BUILDING (Muse Code) -> VISUAL_CHECK (SAM 3.1)
       │      -> écart ? un nouvel essai, sinon PR_READY              [porte : fusion de la PR]
       │    APPLIED (PR fusionnée sur l'app cible)
       │    FEEDBACK (avis sur la feature livrée, données simulées)
       │    ANNOUNCE_DRAFTED -> PUBLISHED                              [porte : publication]
       └─ branche teasing (optionnelle, en parallèle)
            TREND_RESEARCH -> TEASER_DRAFTED -> TEASER_PUBLISHED       [porte : publication]
```

## 3. Réglage d'autonomie
Chaque **porte** a un niveau : `bas` (l'utilisateur valide), `moyen` (l'agent estime s'il faut demander),
`haut` (automatique). Le niveau est réglable par porte et par projet.

## 4. Agents et modèles
| Agent | Rôle | Modèle / outil |
|---|---|---|
| Planificateur | Plan d'implémentation, sous-options techniques (jeu restreint) | Muse Spark (`muse-spark-1.3`) |
| Constructeur | Implémente dans un espace isolé, ouvre une PR | Muse Code (`muse exec`), repli : Muse Spark + outils d'édition |
| Contrôle visuel | Compare l'app à la maquette (boîtes/masques) | `sam-3.1` via API Responses |
| Contenu | Tendances (recherche web) + données d'audience du compte (Insights), texte, visuel | Muse Spark (outil `web_search`), `muse-image-1.0`, API Insights |
| Publication | Publie le post | API Instagram (compte pro, accès standard) |
| Avis | Retour sur la feature livrée, appuyé sur les performances des posts | Muse Spark, Insights réels ou données de démo annoncées comme telles |

## 5. Architecture
Ripple_handoff est indépendant de l'app qu'il fait évoluer : il reçoit en configuration un **projet cible**
(dépôt, fichier Figma, compte de publication, voix de marque).

- **Orchestrateur** : machine à états par feature + journal d'événements + régulateur d'autonomie.
- **Adaptateurs** derrière des interfaces stables, pour pouvoir remplacer un morceau sans toucher au reste :
  - `Builder` : Muse Code, ou repli Muse Spark.
  - `Publisher` : Instagram réel, ou simulé (page locale). Bascule si le compte est bloqué.
  - `Insights` : données d'audience et de performance du compte fournies par Meta (API Insights), ou jeu de
    **données de démonstration** généré, étiqueté comme tel dans l'interface. Un compte neuf n'a pas d'historique.
  - `Vision` : SAM 3.1.
  - `LLM` : Meta Model API, **API Responses** (indispensable pour `web_search`).
- **Compte Instagram interchangeable** : identifiant du compte et jeton viennent de la configuration, jamais du code.
  Si un compte est restreint, on bascule sur un autre en changeant la config (compte professionnel et rôle sur
  l'app Meta requis, jeton à renouveler, 60 jours de validité).
- **Entrée Figma** : lecture de la maquette et détection des changements via l'API Figma.
- **Application des changements** : branche locale sur le dépôt de l'app cible, diff affiché dans la console.
- **Interface web** : chronologie des agents qui se déclenchent, validation aux portes, réglage d'autonomie.

**Stack (validée) :** TypeScript en monorepo pnpm (`console`, `orchestrator`, `shared`). Orchestrateur Node + Hono,
machine à états XState, SQLite (journal d'événements), SSE pour la chronologie, interface Vite + React,
Playwright (captures), Zod (validation des sorties des modèles), SDK `openai` sur l'API Responses de la Meta
Model API (à tester en premier : `web_search`, SAM, Muse Image). L'app cible n'est pas dans ce monorepo.

## 5 bis. Studio de communication (orientation création de contenu)
Le contenu se gère à part du code, par projet (`packages/orchestrator/src/content/`), comme une petite équipe de communication que l'utilisateur manage.
- **Équipe** (`team.ts`) : *Scout* (recherche web : ce qui marche dans le domaine ; pour la veille concurrents, boucle d'outils de la Responses API Meta — `function_call` → exécution locale → `function_call_output` avec `previous_response_id`, outils `search` et `open` dans `scout-tools.ts`, budget de 14 pas, dernier tour sans outil en JSON strict ; la trace des pas est gardée dans le rapport `watch.trail`), *Analyst* (compare le compte du projet à l'audit), *Strategist* (lit audit, compte et **roadmap de dev** : jalons, features, commits ; propose avec une preuve), *Writer* (rédige ce qui est accepté). L'utilisateur brief, accepte ou refuse avec une raison ; les refus alimentent les tours suivants. Ordres permanents lus par tous.
- **Directeur et équipe réglable** : un agent parent (*Director*) reçoit la conversation, synthétise chaque passage et redirige vers l'agent précis. Chaque agent a une configuration par projet (`agent_config` : actif, nombre de ressources 1-3, consignes du manager) et un fil de discussion (`chat`). Les actions suggérées par le Director ou un agent (`run`, `configure`, `talk`) ne s'appliquent jamais seules : le manager confirme par bouton (`POST /team/actions`). Le Director ne peut pas être éteint.
- **Chiffres d'abord** : l'audit du Scout porte des mesures (`figure` par format, `benchmarks`, lien et chiffre de l'exemple), avec la règle « valeur 0 et unité vide = rien trouvé », jamais une invention. Chaque proposition reçoit une **preuve** (`proof`) calculée par le serveur à partir des stats du compte et de l'audit (le modèle ne nomme que le format). Le Director écrit un **plan** (rapport `plan` : mix de formats, levier, cadence) dont les nombres sont rattachés côté serveur, réécrit après chaque passage utile. Les vignettes d'exemples sont récupérées une fois depuis la page (og:image), adresses publiques seulement, sans modèle.
- **Compte** : collé par l'utilisateur et structuré par le modèle (aucun chiffre inventé), ou compte de démo fictif étiqueté. Pas de connexion Insights pour l'instant (`Insights` reste une interface à brancher).
- **Projection qui se corrige** : la date d'arrivée d'un jalon est calculée (rythme observé, sinon le plan de l'utilisateur), jamais décidée par le modèle, qui ne fait que l'expliquer. Chaque projection est conservée. À chaque jalon terminé, l'erreur mesurée sur la projection **brute** donne un coefficient (moyenne géométrique des 5 derniers, borné 0,6-2,5) appliqué aux suivants.
- **Le calendrier suit la projection** : une pièce a un décalage par rapport à l'arrivée du jalon (ou une date verrouillée).
- **Dans le flux de dev** : fusion (`APPLIED`) = nouvelle projection + brouillon de changelog ; `from-git` et hook `post-merge`.
- **Autonomie** : l'équipe propose, l'utilisateur décide. Rien n'est rédigé avant acceptation ; la rédaction anticipée est un réglage par projet ; approuver et publier restent des gestes de l'utilisateur.

## 6. Périmètre
**Dans le cœur :** machine à états et autonomie, lecture Figma, plan, constructeur + branche, contrôle visuel
(une comparaison), contenu avec tendances, publication Instagram, avis après livraison, interface en chronologie.

**Bonus si le temps le permet :** deuxième essai automatique du contrôle visuel, sous-options techniques plus riches.

**Hors périmètre (à présenter comme la suite) :** avis avant livraison, modèles ouverts, publication multi-réseaux,
bêta-testeurs par personas, procédure de tests d'acceptation, différences culturelles, vraies données de stores/trafic.

## 7. Planning (estimation, ~10,5 jours pour ~9 disponibles : très serré)
| Bloc | Jours |
|---|---|
| Machine à états + autonomie | 1 |
| Lecture Figma | 0,75 |
| Planificateur | 0,5 |
| Constructeur + branche | 1,5 |
| Contrôle visuel SAM | 0,75 |
| Contenu (tendances, texte, image) | 1,5 |
| Publication Instagram | 1 |
| Avis (simulé) | 1 |
| Interface chronologie | 1,25 |
| App cible de démo (voir `../mealkinator`) + pitch | 1,25 |

## 8. Règles
- Jamais le **mode contributor** de l'API sur du code ou des données d'utilisateur (Meta peut entraîner dessus).
- Les données d'avis, de trafic et de réactions sont **simulées et annoncées comme telles** dans la démo.
- Les tendances viennent de la recherche web du modèle : approximatives, pas des données internes d'Instagram.
- Les données d'audience de démo (compte sans historique) sont **fictives, générées et étiquetées** dans l'interface
  et dans la démo. On ne les présente jamais comme des mesures réelles.
- Secrets (clé Meta, jeton Instagram, jeton Figma) dans `.env`, jamais commités.
- Comptes de publication réels (pas de faux compte), conformes aux conditions de Meta.

## 9. Risques et points ouverts
1. **Muse Code appelable par programme** : `muse exec` testé le 26 octobre, il exécute une tâche en mode headless et
   écrit dans l'espace de travail. Reste à vérifier : l'authentification (clé d'API ou connexion navigateur), le message
   « Agent delegation: auto unavailable: workspace is untrusted » (espace de travail à déclarer de confiance ?), et la
   fiabilité sur une vraie feature.
2. **Compte de publication neuf** : risque de restriction sur les publications automatisées. Prévoir le `Publisher` simulé.
3. **Images publiques** : Instagram exige une adresse publique et le format JPEG pour les médias, à prévoir.
4. **Fiabilité de bout en bout** : périmètre très serré, démo préparée sur une feature précise et répétée.
5. **Originalité** : les équipes d'agents logiciels existent. Les angles à tenir : design comme pivot, contrôle visuel par SAM, autonomie réglable, public mono-compétence.
6. **Modèles** : vérifier la liste réelle via `GET /v1/models`. Les identifiants changent vite.
7. **API Insights** : permissions requises et disponibilité des données d'audience (certaines semblent soumises à un
   seuil d'abonnés) à vérifier dans la doc officielle. Prévoir le jeu de démo dès le départ.

## 10. À faire avant de coder
- [ ] App développeur Meta (API Instagram) + jeton, pour le compte de publication configuré.
- [x] Clé Meta Model API : valide (`GET /v1/models` renvoie 200, accès à `muse-spark-1.3`, `sam-3.1`, `muse-image-1.0`).
- [x] Installer Muse Code et tester `muse exec` (fonctionne en headless).
- [x] Jeton d'API Figma (`FIGMA_TOKEN`) : lit le cadre `3:102` du fichier Mealkinator (image 1280x800 et structure des calques).
  Le jeton n'a pas la portée « lire l'utilisateur » (`/v1/me` répond 403), ce qui est voulu : portée minimale.
  Reste à confirmer à la main que le jeton vient bien du **nouveau** compte (Figma, Settings, Security).
- [x] Test des appels à la Meta Model API (`node scripts/api-smoke.mjs`, 26 octobre) : tout passe.
  `web_search` via Responses (réponse = dernier item `message`, citations `url_citation`), sortie structurée via
  `text.format` json_schema, Muse Image (JPEG), SAM 3.1. **SAM : des groupes nominaux courts et précis**
  (« outlined button », « logo » trouvent quelque chose ; « button », « card », « text » renvoient une sortie vide,
  qui veut dire « aucune correspondance », pas une erreur). Le contrôle visuel devra donc partir d'une liste de
  requêtes par élément, et non d'un mot générique. En cas d'erreur réseau `ENETUNREACH` (IPv6), lancer avec
  `NODE_OPTIONS=--dns-result-order=ipv4first`.
- [ ] DA de Ripple_handoff (plus tard).

## 11. Espace Figma
Équipe Figma « Ripple_handoff » (vide pour l'instant, la DA viendra plus tard) :
https://www.figma.com/files/team/1696616688424995318


## 5 ter. Lisible d'un coup d'œil

- **Contraste sans éblouir** : page gris clair (`#e6e8ed`), panneaux blanc cassé, encre presque noire, gris secondaire assombri. Le sombre reste au choix.
- **Le travail est visiblement celui de l'équipe** : le journal (`TeamLog`) ouvre *Today* et *Brief* — un agent, une phrase, une heure — et chaque idée dit quand elle a été proposée. Un studio de démo le dit en bandeau.
- **Brief = un geste** : une zone de texte, les trois étapes à cocher avec le dernier résultat de chacune, un bouton. Le déroulé est écrit avant d'appuyer.
- **Un objectif se lit en deux dates** : « You want it on » / « The team expects », chacune avec sa raison ; la barre d'avancement et les features en puces ; les actions destructrices sous *More*.
- **Insights, des formes avant des phrases** : barre segmentée du mix, points du rythme hebdomadaire, classement des formats du terrain en barres, cadence toi / terrain en deux barres de même unité.
- **Team explique** : le flux d'un passage (toi → Scout → Analyst → Strategist → toi → Writer → toi), puis une fiche par agent avec son rôle, son dernier travail et ses deux réglages expliqués en clair.


## 6. Une seule page : quoi poster ensuite, et pourquoi

Testé avec les vraies données de Mairie360 (27 posts, 3 à 19 likes, zéro commentaire), le studio en cinq pages disait beaucoup et n'apprenait rien : classements de formats sur du bruit, « terrain » en unités différentes, journaux d'activité des agents, mécanique en page d'accueil. Le choix : une page, et chaque proposition doit tenir en dix secondes avec quatre choses concrètes.

- **La première ligne** du post, écrite comme elle serait publiée (`pitch.hook`), pas un titre interne.
- **Le canal** où est vraiment le public (`pitch.channel`), quitte à ne pas être celui du compte.
- **Pourquoi**, en français courant, adossé à un fait vérifiable : un post nommé avec son chiffre et sa date, une feature fusionnée, une date, un exemple cliquable.
- **Ce qu'on comptera** une semaine après (`pitch.measure`) : inscriptions, réponses, qui réagit. Jamais « l'engagement ».

Les faits sur le compte sont calculés dans l'interface, sans modèle, et quand les chiffres sont trop petits pour classer quoi que ce soit, la page le dit en une phrase. Le Strategist et l'Analyst reçoivent la même consigne. Les anciennes pages restent dans le code et par URL, pas dans la navigation.


## 7. Une équipe qui tourne, quatre tableaux

« Ça ressemble à un chatbot avec une interface de plus. » La réponse n'est pas une page de plus mais une équipe qui travaille sans qu'on lui demande, et quatre endroits où voir son travail, chacun visuel plutôt que textuel.

- **Create** : propositions à juger, puis le pipeline en vignettes (image générée ou première ligne sur fond teinté). On clique une pièce, on ne lit pas une liste.
- **Platforms** : une carte par plateforme, abonnés, rythme réel en 16 cases, ce qui y est prévu, et où la nourrir. La donnée entre ici, pas dans un onglet caché.
- **Community** : pas un tableau de bord mais une histoire dessinée. Les faits sont calculés côté serveur sans modèle (`facts.ts` : rythme, silences, dérive, question ou non, longueur, jour, mots du meilleur tiers, portée contre réactions), servis à la console qui dessine un petit SVG par constat avec la phrase qui le dit et le nombre de posts derrière ; les mêmes faits sont donnés à l'Analyst, qui ne peut donc pas les contredire. Réactions post par post dans le temps (barres fines ancrées, une teinte par plateforme, légende dès deux), abonnés par plateforme et courbe dès deux relevés, puis le diagnostic tourné en solutions : l'Analyst rend jusqu'à trois correctifs (problème avec le chiffre, solution, premier pas) et chaque premier pas se confie au Writer d'un clic. L'outil ne demande jamais « voulez-vous ça ? » : il décide et propose.
- **Competitors** : le marché en quatre phrases, une fiche par acteur (place, taille, public, canaux, ce qu'il publie, sa force, l'ouverture qu'il laisse), le calendrier du public avec quoi poster autour de chaque date, et les posts d'où s'inspirer avec l'image de la page et le lien. Chaque fiche, date ou trouvaille a un bouton qui met un brief dans le pipeline.
- **Calendar** : le même calendrier pour le public et pour l'équipe. Les dates viennent de la veille du Scout (texte libre « 24-26 novembre 2026 » lu côté console), les pièces de leur jour ; une date sans pièce dans les deux semaines avant est listée en tête avec un bouton qui crée le brief cinq jours avant.
- **Platforms** sert à tenir un rythme, pas à afficher : l'objectif par plateforme (`profile.cadence`) est compté contre la semaine en cours, et le manque devient un brief précis au Strategist.
- **Create** : chaque proposition porte la situation qu'elle répond et pour qui exactement, en plus de la première ligne, du canal et de la mesure ; les pièces acceptées suivent quatre étapes visibles (acceptée, écrite, approuvée, postée) avec le seul bouton attendu.

Le compte vient de trois sources, jamais du scraping : l'API Instagram Graph quand `.env` la nomme (lue avant chaque passage de l'Analyst, et sur demande), l'export LinkedIn collé depuis le tableur (lu à l'exact, colonnes en français ou en anglais), ou un collage libre structuré par le modèle. La démo lit `account.json` au seed.

L'équipe « on duty » (interrupteur dans Settings) fait un passage par jour : veille du terrain et des voisins, relecture du compte, propositions seulement si rien n'attend. Elle n'écrit ni ne poste sans le manager. La démo embarque le vrai passage du 2 novembre 2026 sur Mairie360 (`real.json`) : rien d'inventé côté recherche.
