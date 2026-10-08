# Javapurs — cleanup des fixtures et des runners de ports

Plan v3 — dernière mise à jour : **6 octobre 2026**.

Objectif : supprimer les copies de runtime dans les fixtures, donner un
propriétaire commun à la préparation des workspaces de test et remplacer les
launchers historiques des ports par un parcours isolé, explicite et rejouable.

Les plans précédents sont clôturés : **v1 M01–M11 : 100/100** ; **v2 M12–M16 :
100/100**, avec les **compléments M17–M19 terminés**. Le
[plan v2 archivé](javapurs/docs/plan-v2.md) conserve ses lots, résultats et
nettoyages. Les [preuves M11](javapurs/docs/testing.md#validation-m11) et le
registre M12–M19 restent leurs références datées.

Les chemins sont relatifs à ce dossier : le compilateur est dans `javapurs/`,
les ports dans les dossiers `javapurs-*` voisins.

## Avancement

**100 / 100 points validés — 100 % — 4 lots terminés sur 4.**

**M20–M23 clôturés : runtime et workspaces partagés, 48 launchers délégués au
runner commun.** Les sélections ciblées et les limites de complétion/FFI sont
consignées dans les [preuves M23](javapurs/docs/testing.md#validation-m23) : six
protocoles explicitement non pris en charge et un échec Event Emitter préexistant.

## Constats initiaux vérifiés

Revue du **6 octobre 2026**, compilateur à la révision
`dc6dadf7d3d0213174bdd3aa65f9288121209c63`, checkout initial propre.
Le [relevé préalable](javapurs/docs/testing.md#revue-préalable-au-plan-v3)
donne les références, la méthode et les limites.

| Constat | Point d'entrée | Conséquence pour le cleanup |
| --- | --- | --- |
| Huit suites redéfinissent `TcoLoop` ; `chunk.mjs` fournit aussi un `__IntFn` réduit, sans `IntUnaryOperator` ni `from`. | `javapurs/test/{chunk,tco,counted-loops,int-functions,loop-invariants,ownership,direct-calls,typed-records}.mjs`, `javapurs/src/Javapurs/Runtime.purs`. | Ces fixtures ne compilent pas toutes contre le runtime réellement émis. |
| L'intégration FFI et le runner Aff/Promise réécrivent séparément le YAML et répètent la sélection des quatre ports Aff, Promise, Promise/Aff et Foreign. | `javapurs/test/ffi-ports.mjs`, `javapurs/tools/{fixture-runner,port-test-runner}.mjs`. | Une même correction de dépendance ou de chemin doit être reportée dans plusieurs préparations. |
| Parmi les 48 `bin/test` de ports, 44 sont identiques ; `strings` en est une variante à pile de 64 Mio. Seuls Aff, Promise et Promise/Aff délèguent déjà au runner isolé. | `javapurs-*/bin/test`. | 45 launchers répètent nettoyage, build, génération et choix Java. |
| Ces 45 launchers ignorent les options inconnues, retirent `output`/`java_output`, remplacent `spago.yaml` par un symlink et lancent `javac`/`java` depuis `PATH`, sans cible explicite. | `javapurs-arrays/bin/test`, `javapurs-strings/bin/test`. | La sonde `--clena`, sur copies isolées avec Spago simulé, atteint le build après ces mutations ; les réglages Java communs ne sont pas appliqués par ces scripts. |

Le backend possède déjà des modules séparés pour traduction, portées, chunking,
représentations, sorties et diagnostics. Le besoin identifié concerne surtout
les fixtures et l'outillage autour des ports. Le build JavaScript `output/` du
compilateur reste un artefact actif du launcher ; son statut est décrit dans le
[guide d'entretien](javapurs/docs/maintenance.md#statut-des-fichiers-et-des-sorties).

## Règles de suivi et de validation

- Les quatre cases M20–M23 déterminent le score. Les points mesurent les livrables
  validés, pas leur durée ; les scores historiques restent propres à leurs plans.
- Réaliser chaque lot en petites passes. Avant une modification de port, relever
  sa révision, son état Git, son entrypoint, ses ressources de test et son résultat
  de référence sur la sélection concernée.
- Cocher un lot après son critère de fin, ses contrôles pertinents et une entrée
  datée dans le [registre](javapurs/docs/testing.md#consigner-une-validation) :
  fichiers, références, commandes, résultats et limites. Actualiser date, score
  et prochaine étape.
- **Validation ciblée uniquement :** pas de `t -c`, de corpus entier ni de
  `modtest`. Les lots de migration utilisent des sondes d'outillage et une liste
  explicite de ports représentatifs, revue à chaque passe.
- Conserver les assertions sémantiques et les modes de représentation des suites.
  La déduplication de leur support ne doit pas rendre le résultat attendu dépendant
  de l'implémentation testée. Pour une modification de génération, reconstruire
  les composants concernés et comparer inventaire/octets Java sur les mêmes
  TAST, options et FFI, avec explication de chaque écart attendu.
- Conserver les garanties M12–M19 : attente asynchrone et propagation des échecs,
  diagnostics FFI, entrées TAST/JVM strictes, publication des sorties et cible Java.
  Un échec préexistant ou un protocole de suite non pris en charge reste visible
  et documenté ; la migration d'un launcher n'établit pas la couverture de sa FFI.
- Terminer chaque passe par `node tools/check-docs.mjs` depuis `javapurs/`,
  `git diff --check` dans les dépôts touchés et une revue des diffs, y compris ce
  TODO situé hors du dépôt Git du compilateur.

## Lots, dans l'ordre de travail

- [x] **M20 — 20 points — Fixtures utilisant le runtime de production.**
  - **Constat :** huit définitions locales de `TcoLoop` et une interface `__IntFn`
    partielle coexistent avec les templates de `Javapurs.Runtime`. Les variantes
    diffèrent par leurs modificateurs et, dans `chunk.mjs`, par le contrat Java.
  - Points d'entrée : les huit suites inventoriées ci-dessus,
    `javapurs/src/Javapurs/Runtime.purs` et les consommateurs existants dans
    `javapurs/test/{codegen,printer,ownership-admission,ownership-loops}.mjs`.
  - Importer les templates construits et les écrire comme fichiers Java séparés
    là où la compilation les requiert. Garder les entrées AST, assertions,
    contre-exemples, variantes on/off et limites mémoire propres à chaque suite.
  - Inclure les branches optionnelles de `direct-calls` et `typed-records` qui
    chargent des entrées optimisées externes ; relever leur couverture effective.
  - **Fin :** aucune réimplémentation de `TcoLoop`/`__IntFn` dans ces fixtures ;
    elles compilent avec les templates courants et conservent leurs assertions.
  - **Validation ciblée :** les huit suites concernées, en conservant leurs modes
    existants ; exercer les deux branches optionnelles avec leurs entrées nommées
    préparées et figées. Vérifier que les écarts de sources Java des fixtures sont
    limités au support remplacé ; consigner les entrées et comptes d'assertions.
  - **Clôture — 6 octobre 2026 :** huit copies de `TcoLoop` et le `__IntFn`
    partiel retirés ; templates importés depuis `Javapurs.Runtime`. Les cinq
    invocations optionnelles initialement bloquées par le contrat de cache PBO
    utilisent désormais `test/support/optimized-module.mjs` : fermeture d'imports
    TAST, build/lecture dans le même processus, scratch isolé et projet préservé.
    **14 commandes / 18 variantes JVM** réussies, JDK 26.0.2 et release 17 ;
    RBTree, Records typés/Maps, Church et LazyEvaluation exercés sur **38 TAST
    figés**. Comparaison : **104 Java identiques, 11 templates remplacés,
    3 supports embarqués retirés et 4 fichiers runtime ajoutés** ; assertions
    sémantiques conservées. Trois sondes de préparation vérifient cache résiduel
    invalide, métadonnées TAST et erreur d'écriture. Voir les
    [preuves M20](javapurs/docs/testing.md#validation-m20).

- [x] **M21 — 25 points — Préparation déclarative des workspaces de test.**
  - **Constat :** `prepareWorkspace` rebase le gabarit commun, puis `ffi-ports`
    et `preparePortSuite` ajoutent chacun des dépendances et les mêmes quatre
    chemins locaux par remplacement/concaténation de chaînes YAML.
  - Points d'entrée : `javapurs/tools/{fixture-runner,port-test-runner}.mjs`,
    `javapurs/test/ffi-ports.mjs`, `javapurs/tests/runner/spago.yaml` et
    `javapurs/test/test-tools.mjs`.
  - Donner un propriétaire unique à la composition des profils et à la sélection
    locale Aff/Promise/Promise-Aff/Foreign. Les différences de dépendances entre
    intégration et suites de ports doivent rester explicites dans leurs profils.
  - Vérifier les chemins requis et signaler un gabarit inattendu plutôt que de
    poursuivre après un remplacement sans effet. Écrire uniquement la configuration
    du workspace préparé, en préservant sources et configuration d'origine.
  - Préparer la réutilisation par M22 : chemins avec espaces, sources et FFI
    auxiliaires, chemins de configuration rebasés et version du package set explicite.
    Les ports historiques utilisent 77.7.0, le runner du compilateur 77.10.1.
  - **Fin :** les deux consommateurs partagent la même préparation ; leurs graphes
    de dépendances et sélections FFI sont conservés, avec diagnostic d'un port
    local absent et sans mutation du gabarit ou du port source.
  - **Validation ciblée :** sondes Node dans `test-tools.mjs` pour composition,
    chemins, absence et préservation ; `ffi-ports.mjs` et les trois sélections
    explicites de `port-runners.mjs`, avec leurs assertions et sondes négatives.
  - **Clôture — 6 octobre 2026 :** `javapurs/tools/workspace-config.mjs` possède les
    profils `fixture`, `ffi-ports` et `port-suite`, la sélection des quatre ports
    locaux et le retrait explicite de Foreign pour la sonde de registre. Gabarit,
    chemins et conflits sont vérifiés avant écriture ; versions de package set et
    bloc de test sont conservés. **18 tests Node**, **25 assertions FFI × 4 modes
    d'exécution**, **45/13/7 contrôles de ports** et **12 sondes négatives** réussis,
    JDK/JVM 26.0.2, release 17, workspaces réels avec espaces. Les **21 fichiers
    préparés**, dont cinq configurations Spago, sont identiques à la référence ;
    les 23 ports locaux et le gabarit gardent leurs empreintes. Voir les
    [preuves M21](javapurs/docs/testing.md#validation-m21).

- [x] **M22 — 35 points — Runner commun de ports et trois migrations pilotes.**
  - **Constat :** les 45 launchers historiques possèdent un second pipeline de
    test alors que les outils communs gèrent déjà processus, logs, workspaces et
    cible/JVM. La sonde de faute d'option confirme des mutations avant diagnostic.
  - Points d'entrée : `javapurs/tools/{port-test-runner,fixture-runner,java-tools}.mjs`,
    `javapurs/tools/{test-process,test-workspace}.mjs`, `javapurs/test/test-tools.mjs` et les
    `bin/test` de **Refs, Exceptions et Strings**, choisis comme pilotes.
  - Construire le parcours commun à partir de ces outils : sélection et options
    validées avant préparation, aide sans effet de bord, `-c`/`--clean` via
    `bin/build`, workspace isolé, journaux par phase et conservation en cas d'échec.
  - Appliquer `JAVAPURS_JAVA_RELEASE` et `JAVAPURS_JAVA_RUNTIME`, borner les phases
    et propager leurs erreurs/interruptions. Conserver le réglage de pile de
    Strings comme donnée du profil, séparément de la cible Java.
  - Décrire l'entrypoint, les sources/ressources et le protocole de fin du port.
    Utiliser les wrappers d'attente existants pour les suites asynchrones ;
    un simple retour de `launchAff_` ne prouve pas la fin d'une suite.
  - Remplacer les trois launchers pilotes par des délégations minces. Leurs sources,
    lockfiles, `spago.yaml` et anciens outputs doivent rester intacts après le test.
  - **Fin :** les trois pilotes passent par le même parcours, avec options strictes,
    résultats de processus fiables, traces de phases et choix Java effectifs.
  - **Validation ciblée :** commandes simulées pour faute d'option/aide, chaque
    échec de phase, timeout, interruption, paramètres Java et absence de mutation ;
    exécution réelle des trois suites pilotes. Vérifier un pilote compilé par un
    JDK récent en release 17 puis exécuté sur JVM 17 ; rejouer les sondes Aff/Promise
    si leur chemin commun est modifié. Comparer avant/après la sélection FFI et le
    Java sur les entrées pilotes figées.
  - **Clôture — 6 octobre 2026 :** trois launchers remplacés par des délégations
    minces au runner commun ; profils synchrones avec `src/`, `test/`, gabarit
    propre en 77.7.0 et pile Strings conservés. **24 tests Node** réussis : options,
    aide, trois délégations, cinq échecs de phase, quatre timeouts, SIGINT/SIGTERM,
    cible/JVM et préservation. Les trois pilotes passent ; Refs est aussi compilé
    en release 17 par JDK 26 puis exécuté sur JVM 17, classe majeure 61. Les trois
    ports asynchrones conservent **65 contrôles et 12 sondes négatives**.
    Comparaison sur **604 TAST figés : 972 Java identiques**, rapports FFI identiques
    après normalisation des racines temporaires. Voir les
    [preuves M22](javapurs/docs/testing.md#validation-m22).

- [x] **M23 — 20 points — Migration bornée des 42 autres launchers historiques.**
  - **Constat :** les trois pilotes laissent 42 copies du pipeline shell à retirer.
    Les ports ont des entrypoints et ressources différents ; notamment UUID et
    Yoga JSON lancent actuellement leurs tests avec `launchAff_`.
  - Points d'entrée : les autres `javapurs-*/bin/test`, leurs `test/` et profils,
    le runner commun livré en M22, `javapurs/docs/{testing,maintenance}.md`.
  - Inventorier les 45 launchers historiques, pilotes inclus, avec leur destination
    commune, entrypoint, ressources, réglages particuliers et protocole de fin.
    Migrer les 42 restants par petits groupes de même profil.
  - Pour les suites asynchrones, exposer une action attendable ou diagnostiquer
    explicitement un protocole non encore pris en charge. Préserver chaque
    assertion ; un blocage préexistant reçoit une référence et un résultat d'échec
    explicite, jamais un succès de remplacement.
  - Contrôler toutes les délégations avec commandes simulées, puis choisir les
    exécutions réelles selon les différences relevées : au minimum **Arrays**,
    **Node Path** et **UUID** en plus des pilotes. Ajouter une sélection nommée
    pour tout profil supplémentaire réellement introduit.
  - **Fin :** les 45 launchers historiques délèguent au parcours commun ; le relevé
    distingue migration d'outillage, suites réellement exécutées et limites
    préexistantes. Les trois ports M12 conservent leur attente et leurs sondes.
  - **Validation ciblée :** délégations/arguments des 45 profils, conservation des
    checkouts et configurations, sélection réelle ci-dessus et sondes négatives
    des adaptateurs asynchrones modifiés. Mettre à jour la matrice, les commandes
    des README concernés et le bilan du plan avec ses limites de couverture.
  - **Clôture — 6 octobre 2026 :** les 45 launchers historiques délèguent au
    parcours commun (48 avec les trois M12) ; inventaire des révisions, ressources,
    configurations et protocoles livré. **27 tests Node**, **13 suites réelles**
    (12 réussies, Event Emitter en échec préexistant 1/14), **22 sondes négatives**
    réussies et six rejets explicites de protocole. Arrays, Node Path, UUID,
    Prelude, Partial, Console, les trois pilotes et les trois ports M12 sont
    exercés ; UUID attend ses six tests. Les 29 autres suites synchrones restent
    couvertes uniquement par les sondes de délégation/préparation. **1 479 Java**
    comparés sur cinq sélections : seuls 208 commentaires de chemins FFI relatifs
    diffèrent ; graphes et FFI conservés. Les 54 ports, les 52 sources du backend
    et ses 1 018 fichiers construits sont audités. Voir l'[inventaire](javapurs/docs/port-launchers.md)
    et les [preuves M23](javapurs/docs/testing.md#validation-m23).

## Points d'appui

- [Revue préalable et références](javapurs/docs/testing.md#revue-préalable-au-plan-v3).
- [Matrice des tests](javapurs/docs/testing.md#matrice-des-tests) et
  [contrats FFI/runtime](javapurs/docs/ffi-runtime.md).
- [Entretien et sujets de poursuite](javapurs/docs/maintenance.md).
- [Plan v2 archivé, compléments et nettoyage](javapurs/docs/plan-v2.md).
