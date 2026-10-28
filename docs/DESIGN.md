# Ripple_handoff — design

Projet du Meta Global AI Developer Hackathon, piste **Indie** (solo). Rendu : 4 novembre 2026, 21h (heure de l'Est).
Statut : conception, aucun code.

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

## 5 bis. Contenu planifié (orientation création de contenu)
Le contenu n'est plus seulement la fin de la chaîne dev : il se planifie à part, par projet (`packages/orchestrator/src/content/`).
- **Feuille de route** : jalons (titre, intention en langage libre, date voulue, nombre de features). L'utilisateur précise ce qu'il veut, l'IA propose les pièces (changelog, notes de version, devlog, post, teaser, doc, script de démo, newsletter) et les rédige dans la voix du projet.
- **Projection qui se corrige** : la date d'arrivée d'un jalon est calculée (rythme observé, sinon le plan de l'utilisateur), jamais décidée par le modèle ; le modèle ne fait que l'expliquer. Chaque projection est conservée. Quand un jalon se termine, l'erreur mesurée sur la projection **brute** (avant correction) donne un coefficient (moyenne géométrique des 5 derniers jalons, bornée à 0,6-2,5) appliqué aux jalons suivants.
- **Le calendrier suit la projection** : une pièce a un décalage par rapport à l'arrivée du jalon (ou une date verrouillée) ; si la projection glisse, la pièce glisse.
- **Dans le flux de dev** : fusion d'une feature (`APPLIED`) = nouvelle projection du jalon + brouillon de changelog ; endpoint `from-git` + hook `post-merge`.
- **Autonomie** : la rédaction automatique est un réglage par projet ; approuver et publier restent des gestes de l'utilisateur.

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
