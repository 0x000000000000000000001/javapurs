> Archive du TODO à l'ouverture du [plan v4](../todo.md), le 21 octobre 2026.
> Les scores et clôtures ci-dessous restent historiques.

# Javapurs — cleanup des fixtures et des runners de ports

Plan v3 et compléments — dernière mise à jour : **20 octobre 2026**.

Objectif : supprimer les copies de runtime dans les fixtures, donner un
propriétaire commun à la préparation des workspaces de test et remplacer les
launchers historiques des ports par un parcours isolé, explicite et rejouable.

Les plans précédents sont clôturés : **v1 M01–M11 : 100/100** ; **v2 M12–M16 :
100/100**, avec les **compléments M17–M19 terminés**. Le
[plan v2 archivé](plan-v2.md) conserve ses lots, résultats et
nettoyages. Les [preuves M11](testing.md#validation-m11) et le
registre M12–M19 restent leurs références datées.

Ce TODO est suivi à la racine du compilateur. Les chemins de code historiques
ci-dessous sont relatifs au workspace parent : `javapurs/` désigne ce dépôt,
les ports sont les dossiers `javapurs-*` voisins.

## Avancement

**100 / 100 points validés — 100 % — 4 lots terminés sur 4.**

**M20–M23 clôturés : runtime et workspaces partagés, 48 launchers délégués au
runner commun.** Les sélections ciblées et les limites de complétion/FFI sont
consignées dans les [preuves M23](testing.md#validation-m23) : six
protocoles explicitement non pris en charge et un échec Event Emitter préexistant.

**Complément M24 clôturé : sorties `output/java`, deux builds b8x consécutifs
réussis et `Ping` exécuté sur Java 17.** Voir les
[preuves M24](testing.md#validation-m24).

**Complément M25 clôturé : FFI Node EventEmitter corrigée, 19/19 tests et cinq
sondes réussis.** Voir les [preuves M25](testing.md#validation-m25).

**Complément M26 clôturé : Node Streams repasse en protocole synchrone avec un
tampon d'événements propre aux streams.** Quatre protocoles restent rejetés
après M27.

**Complément M27 clôturé : Node FS exécute ses suites synchrones, attend son
action Aff et termine sur le marqueur commun.**

**Complément M28 clôturé : Node Net attend la fermeture du socket et corrige
`addressTcpImpl` (`Nullable`).**

**Complément M29 clôturé : Yoga JSON passe 52/52 avec `undefined`, BigInt et
dates corrigés.**

**Complément M30 clôturé : Spec pur passe 62/62, trois pending ; l'intégration
`node-child-process` est couverte ensuite par M32.**

**Complément M31 clôturé : Node HTTP passe, y compris les upgrades 426/101 et
le socket client.** Tous les protocoles du runner sont désormais traités.

**Complément M32 clôturé : l'intégration Spec passe 70/70 (62 purs + 8 cas
d'intégration) avec le port `node-child-process` et le harnais `spago` local.**

## Constats initiaux vérifiés

Revue du **6 octobre 2026**, compilateur à la révision
`dc6dadf7d3d0213174bdd3aa65f9288121209c63`, checkout initial propre.
Le [relevé préalable](testing.md#revue-préalable-au-plan-v3)
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
[guide d'entretien](maintenance.md#statut-des-fichiers-et-des-sorties).

## Règles de suivi et de validation

- Les quatre cases M20–M23 déterminent le score. Les points mesurent les livrables
  validés, pas leur durée ; les scores historiques restent propres à leurs plans.
- Réaliser chaque lot en petites passes. Avant une modification de port, relever
  sa révision, son état Git, son entrypoint, ses ressources de test et son résultat
  de référence sur la sélection concernée.
- Cocher un lot après son critère de fin, ses contrôles pertinents et une entrée
  datée dans le [registre](testing.md#consigner-une-validation) :
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
  TODO situé à la racine du dépôt Git du compilateur.

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
    [preuves M20](testing.md#validation-m20).

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
    [preuves M21](testing.md#validation-m21).

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
    [preuves M22](testing.md#validation-m22).

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
    et ses 1 018 fichiers construits sont audités. Voir l'[inventaire](port-launchers.md)
    et les [preuves M23](testing.md#validation-m23).

## Compléments au plan v3

- [x] **M24 — Sorties Java intégrées à `output` et builds b8x répétés**
  - Dériver la destination implicite `<input>/java`, réserver ce seul sous-arbre
    dans le lecteur TAST et conserver le refus des autres dossiers invalides.
  - Adapter runners, exemples et b8x à `output/java/classes`, puis retirer
    les artefacts b8x historiques après sauvegarde vérifiée.
  - Valider chemins explicites/symlinks, publication, comparaison Java sur TAST
    figés, parcours ciblés et deux builds b8x consécutifs avec lancement `Ping`.
  - **Clôture — 9 octobre 2026 :** contrôles du compilateur et runners réussis ; expansion exponentielle des
    gardes lazy révélée par b8x, reproduite et corrigée dans `DirectCalls`.
    40 contrôles JVM par mode, 86 Java du driver et 329 Java BigFunction identiques.
    **Deux builds b8x consécutifs réussis**, heap habituel de 16 Gio : 2 685 TAST,
    2 696 Java et manifeste identiques ; 39 189 classes ciblent Java 17. `Ping`
    répond `pong` après chacun sur JVM 17. Ancien `java_output` sauvegardé et
    retiré, documentation/syntaxes/diffs vérifiés. Voir les
    [preuves M24](testing.md#validation-m24).
  - **Complément `runj` — 9 octobre 2026 :** les consommateurs
    `altbak.pub-{gopurs,javapurs}/bin/java/run` utilisent aussi `output/java` et
    `output/java/classes`. L'alias `runj` appelle `altj` et bascule vers le
    checkout `altbak.pub-javapurs` : correction appliquée et vérifiée dans cette
    destination effective, avec `-c`. Build du JAR `pure`, Fibonacci ciblé,
    reconstruction avec classe obsolète et `--run-only` validés ; oracle `55`.

- [x] **M25 — FFI Node EventEmitter et régressions d'événements**
  - Aligner `unsafeEmitFn` sur l'ABI `EffectFn` Java (effet `Boolean`), sans
    perdre l'arité variable des arguments d'événement.
  - Conserver les arguments des listeners `once` et permettre leur désinscription
    par le callback retourné ; rapprocher le comportement de Node pour l'ordre,
    le rejet des événements passés et la propagation des exceptions.
  - Ajouter des assertions ciblées sur le retour d'`emit`, les arguments
    multiples, les listeners tardifs, l'unicité de `once` et les exceptions.
  - **Clôture — 19 octobre 2026 :** `EventEmitter.java` corrigé ; la suite
    d'origine et cinq régressions passent **19/19**, avec les cinq sondes
    négatives du runner. `unsafeEmitFn` expose désormais un `Supplier` par appel
    et accepte les arguments successifs via un proxy callable ; les wrappers
    `once` transmettent leurs arguments, se retirent avant l'appel et restent
    désinscriptibles. Les événements passés ne sont plus rejoués et les
    exceptions des listeners remontent. La sonde Node Streams révèle un besoin
    distinct, traité en M26. Voir les [preuves M25](testing.md#validation-m25).

- [x] **M26 — Node Streams : tampon d'événements eager**
  - Conserver le non-rejeu de l'EventEmitter général tout en émulant le tampon
    des streams Node, dont les événements `data`/`readable`/`end` sont eager.
  - Borner l'historique, le limiter aux `ReadableStream`, puis valider un
    listener `data` ajouté après l'écriture et la suite complète.
  - **Clôture — 19 octobre 2026 :** `Node/Stream.java` conserve un historique de
    **4 096 événements** par stream et le rejoue au listener ajouté, sans changer
    `Node.EventEmitter`. `Test.Main` ajoute un test de listener tardif ; la suite
    passe en protocole synchrone. Le rejeu reste explicite et borné, limité aux
    streams eager. Voir les [preuves M26](testing.md#validation-m26).

- [x] **M27 — Node FS : jonction de l'action Aff et fin des streams**
  - Exposer `TestAff.testAff` comme action attendable et ajouter un wrapper qui
    exécute les suites synchrones avant de l'attendre.
  - Terminer les streams de fichier eager par `end`, réutiliser l'historique de
    M26 et vérifier le flux `pipe` jusqu'à `all good`.
  - **Clôture — 19 octobre 2026 :** `tests/port-suites/Fs.purs` exécute `Test`,
    `TestAsync`, `Test.Streams`, attend `TestAff.testAff`, puis publie `[OK]` et
    le marqueur commun. La suite passe en protocole synchrone avec wrapper ;
    les logs montrent `all good`, la liste des répertoires et
    `PORT SUITE COMPLETED`. Voir les [preuves M27](testing.md#validation-m27).

- [x] **M28 — Node Net : attente du cycle socket et `addressTcp`**
  - Exposer `Test.Main.testNet :: Aff Unit`, attendre la fermeture finale du
    socket et joindre cette action par un wrapper.
  - Enregistrer les listeners avant l'émission eager de `listening` et corriger
    le retour `Nullable` de `addressTcpImpl`.
  - **Clôture — 19 octobre 2026 :** `tests/port-suites/Net.purs` attend
    `testNet`, puis publie `[OK]`. Les logs couvrent serveur, connexion,
    données, fin socket, fermeture et marqueur commun. Voir les
    [preuves M28](testing.md#validation-m28).

- [x] **M29 — Yoga JSON : undefined, BigInt et dates**
  - Contourner `spec-discovery` en composant explicitement les quatre Specs,
    puis exécuter cette composition avec le wrapper Spec commun.
  - Distinguer `undefined` de `null` dans `Foreign` et `Foreign.Index`, indexer
    les tableaux, omettre les propriétés `undefined` à la sérialisation, écrire
    les BigInt en chaînes et fournir `JSDate.toISOString`/parse ISO.
  - **Clôture — 20 octobre 2026 :** **52/52 tests** et cinq sondes réussis.
    `Foreign.undefined` est un sentinel partagé ; les propriétés absentes et les
    index hors bornes le renvoient. `Foreign.Index` lit aussi `Object[]`.
    `Yoga.JSON` omet les champs `undefined`, écrit `BigInteger` en chaîne et
    `JSDate` produit/parse l'ISO avec millisecondes. BigInt compare en `int`.
    Vérifications croisées : EventEmitter 19/19, Node Streams, Node FS, Node Net
    et `ffi-ports` 25 contrôles × 2 représentations × classes/JAR. **Deux**
    protocoles restent rejetés : Node HTTP et Spec. Voir les
    [preuves M29](testing.md#validation-m29).

- [x] **M30 — Spec : périmètre pur sur JVM**
  - Exporter `Test.Main.pureSpec` et exécuter cette composition avec un wrapper
    Spec dédié, sans `spec-node` ni découverte dynamique.
  - Autoriser les pending intentionnels, exiger zéro échec, puis vérifier les
    sondes communes. Les tests d'intégration `node-child-process` restent hors
    périmètre.
  - **Clôture — 20 octobre 2026 :** `tests/port-suites/SpecOnly.purs` exécute
    **62/62 tests**, avec **3 pending** et cinq sondes. Les six modules Spec purs
    sont couverts ; l'intégration `npx`/`spec-node` n'est pas déclarée validée.
    **Un** protocole reste rejeté : Node HTTP. Voir les
    [preuves M30](testing.md#validation-m30).

- [x] **M31 — Node HTTP : upgrade et complétion**
  - Exposer `testHttp :: Aff Unit`, joindre `testUpgradeAff` et ajouter un
    wrapper qui attend la suite avant le marqueur.
  - Normaliser les en-têtes serveur/client en minuscules, émettre `upgrade`,
    répondre 101 avec le socket client et ne pas lire de corps après upgrade.
  - **Clôture — 20 octobre 2026 :** suite HTTP locale et upgrades 426/101
    exécutés, `[OK] node-http suite` et `PORT SUITE COMPLETED`. Les deux tests
    d'URL externes sont opt-in via `JAVAPURS_HTTP_EXTERNAL=1` ; le parcours par
    défaut est hermétique. **Aucun protocole rejeté** ; les 48 sélections sont
    traitées. Voir les [preuves M31](testing.md#validation-m31).

- [x] **M32 — Spec : intégration réelle via `node-child-process`**
  - **Constat :** Spec pur est validé (M30), mais les huit cas d'intégration
    lancent `npx spago`/`spec-node` via `node-child-process`, absent du backend
    JVM. Une tentative exploratoire a ajouté des ports locaux
    `node-child-process` et `node-os`, exécuté les cas, puis rencontré deux
    obstacles : conventions de callback hétérogènes dans `Node.FS.Async`
    (`(error, value)` contre callback unaire) et environnement `npm/npx`
    temporaire dépassant les limites de validation ciblée.
  - Fournir un port Java de `Node.ChildProcess` (`spawn`, stdout/stderr,
    `exit`/`close`/`error`) et les primitives `node-os` nécessaires.
  - Corriger ou contourner les conventions de callback de `Node.FS.Async` avec
    des tests de non-régression sur les opérations `access`, lecture, écriture
    et répertoires.
  - Préparer l'environnement d'intégration hors ligne ou avec un cache
    `npm`/Spago explicite, borner chaque sous-processus et conserver ses logs.
  - **Validation ciblée :** les huit cas d'intégration Spec, leurs ressources et
    le wrapper de fin, sans modifier les assertions upstream ; comparer les
    sorties golden et documenter toute dépendance réseau/outillage.
  - **Clôture — 20 octobre 2026 :** phase A validée par
    `test/child-process.mjs` (`spawn /bin/sh`, stdout `child-ok`, code 0) dans
    `javapurs-node-child-process`. La phase B utilise le `spago` local, corrige
    les callbacks unaires de `Node.FS.Async`, borne les sous-processus (stdin
    `/dev/null`, timeout 60 s, une reprise si la sortie est vide) et rejoue les
    événements `exit`/`close` aux listeners tardifs. `../javapurs-spec/bin/test`
    termine **code 0, 70/70 checks** (62 Spec purs + 8 intégrations) et les cinq
    sondes ; aucune assertion upstream modifiée. Voir les
    [preuves M32](testing.md#validation-m32).

## Points d'appui

- [Revue préalable et références](testing.md#revue-préalable-au-plan-v3).
- [Matrice des tests](testing.md#matrice-des-tests) et
  [contrats FFI/runtime](ffi-runtime.md).
- [Entretien et sujets de poursuite](maintenance.md).
- [Plan v2 archivé, compléments et nettoyage](plan-v2.md).
