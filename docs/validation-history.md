# Historique des validations

Archive des récits de validation M01–M32 des plans v1–v3, déplacée hors du
guide opérationnel par M45. Les liens `testing.md#validation-mXX` sont
redirigés par des ancres explicites dans [le guide de test](testing.md#validations-historiques).

## Validation M01

**1er octobre 2026 — carte du projet et documentation fiable.**

Références du code examiné, avant les modifications documentaires :

| Dépôt | Révision |
| --- | --- |
| Javapurs | `372439b5523edcba94a10ac7747986f865303801` ; checkout initial propre. |
| PBO Java | `0f41544464ec0f42e6cb0dd77b206852813f904f` ; checkout propre. |
| Checkout du fork PureScript | `3c27d1eeb68d9831e5157eacdae64043c7f45ba8` ; distinct de l'étiquette du binaire `purs` inventorié. |
| Port Aff | `6965604bb7a26cd3836a30cf538bdd8b3ff058d5`. |
| Port Refs | `753153553468d12c415590af69bf9b935bc77147`. |
| Port Promise | `3af76a1273a16cb5e08dfd7dd6593fdc6f51cc8a`. |

Livrables : `README.md`, `docs/compiler.md`, `docs/testing.md` et suivi M01 dans
le `todo.md` du workspace. La carte couvre les phases réelles, les représentations,
les options, les noms générés et les implémentations Effect/Aff/Ref/Promise.

Contrôles documentaires réalisés :

- confrontation des options et de l'ordre des passes à `Main`, `CodeGen`,
  `DirectCalls`, `Rename` et `Chunk` ;
- confrontation des chemins FFI au résolveur PBO et des contrats runtime aux ports ;
- inventaire des versions par `--version` et des révisions par `git rev-parse HEAD` ;
- `./bin/test BigFunction DerivingTraversable --list` : deux noms attendus,
  code de sortie 0 ;
- script Python ponctuel : **101 liens locaux/ancres valides**, correspondance
  des **7 options CLI** avec `Main` et des **13 suites** avec `test/*.mjs` ;
- `bash -n` sur les **13 blocs Bash** documentés : syntaxe valide ;
- script de recalcul du TODO : `Avancement : 5/100 points — 5% — 1/11 lots` ;
- revue du diff, contrôle des espaces des quatre documents et
  `git diff --check` : succès, code de sortie 0.

**Conclusion : M01 validé, +5 points. Prochain lot : M02 — tests ciblés faciles
à rejouer.**

Les contrôles de M01 portent sur la documentation et la sélection des commandes.
Les résultats d'exécution du tableau précédent sont les références acquises
avant ce lot.

## Validation M02

**1er octobre 2026 — tests ciblés faciles à rejouer.**

Base du lot : Javapurs `4ad2966eb6cd37362bff94a395993905a1a00f97`, checkout
initial propre. Outils : versions de l'inventaire M01 ; `javac`/`java` résolus
vers le même JDK OpenJDK 26.0.2. Les temporaires des vérifications ont utilisé
`TMPDIR=/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode`.

### Livrables et décisions

- `bin/test` est un launcher vers `tools/passing-runner.mjs`. La sélection complète
  est validée avant build/nettoyage ; noms, options et bornes invalides sortent en 2.
- `tools/fixture-runner.mjs` partage préparation et phases avec BigFunction.
  `tests/runner/spago.yaml` est la source unique des packages ; `bin/pkg`, devenu
  sans consommateur, a été retiré.
- `tools/java-tools.mjs`, `tools/test-workspace.mjs` et `tools/test-process.mjs`
  partagent les contrats JDK, temporaires et processus. Les onze suites AST/Java
  et BigFunction les utilisent. Le support des ports réutilise le choix du JDK
  et propage l'interruption même en mode keep-going.
- `test/big-function.mjs` prépare le corpus et son harness dans un workspace
  isolé ; les échecs conservent les entrées et logs.
- `test/test-tools.mjs` vérifie les contrats avec un petit dépôt et des commandes
  simulés, dont le cas d'un parent défaillant laissant des descendants actifs.
- README, guide et matrice ont été actualisés pour ces commandes et responsabilités.

### Défaut révélé par le rejeu des appels directs

Le helper de `test/direct-calls.mjs` pouvait attribuer à `lazy` le worker de
`pair`, simplement parce que son corps l'appelait. Cet échec a été reproduit
sur la version de départ, puis le helper a été corrigé pour reconnaître le
worker émis avec sa déclaration.

Le test d'exécution a ensuite révélé une différence sémantique : un getter lazy
appelé depuis un initialiseur antérieur pouvait appeler directement le worker
d'un champ eager encore nul. `src/Javapurs/DirectCalls.purs` transporte désormais
le contexte `fromLazy` et garde ce champ avant de choisir l'appel direct. Le
chemin de repli conserve l'arrêt avant l'évaluation des arguments suivants.
Les appels entre déclarations eager gardent leur forme directe ; les fichiers
construits de `Javapurs.DirectCalls` ont été régénérés.

### Commandes et résultats

| Contrôle ciblé | Résultat |
| --- | --- |
| `node --test test/test-tools.mjs` | **11/11** ; sélection/absence d'effets, préparation, logs, JDK, échecs de processus, timeout et SIGINT/SIGTERM. |
| `./bin/build` | **0 erreur** ; 5 avertissements dans `CodeGen` concernant les imports et des motifs inaccessibles. |
| `node test/chunk.mjs` | **11 fixtures**. |
| `node test/direct-calls.mjs` | **37 contrôles runtime par mode**, direct désactivé puis activé, et assertions d'admission. |
| `node test/big-function.mjs`, lancé depuis le dossier temporaire par son chemin absolu | Pipeline complet réussi, puis **155 contrôles**, dont 26 motifs non vides entièrement réussis. Rejoué après correction de `DirectCalls`. |
| `./bin/test DerivingTraversable` | **1 passed, 0 failed**, avant puis après la correction d'initialisation. |
| `node test/tco.mjs`, `node test/counted-loops.mjs`, `node test/nullary-constructors.mjs`, `node test/typed-records.mjs`, `node test/loop-invariants.mjs`, `node test/int-functions.mjs`, `node test/operators.mjs`, `node test/constructor-reuse.mjs`, `node test/ownership.mjs` | Tous réussis ; les consommateurs CodeGen concernés ont été rejoués après la correction. |

Deux comparaisons complètent ces exécutions :

- après le premier BigFunction isolé, les **1 254 fichiers** `src`, `java_output`
  et `classes` du runner partagé ont les mêmes chemins et SHA-256 ;
- après refactoring du runner, avant la correction de `DirectCalls`, les
  **331 sources Java** de `DerivingTraversable` ont le même inventaire et les
  mêmes SHA-256. La correction d'initialisation qui suit est un changement
  sémantique explicite, vérifié avec les deux modes d'appels directs.

Vérifications finales : syntaxe des modules Node et du launcher Bash, sélection
documentée avec `--list`, liens/ancres et matrice des 14 suites, recalcul du score,
revue du diff depuis la base du lot et `git diff --check`.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m02/`,
notamment `test-tools-final.log`, `build.log`, `big-function-final.log`,
`deriving-traversable-final.log`, `deriving-java-comparison.txt`,
`direct-calls-before.log` et `direct-calls-initialization-failure.log`.

**Conclusion : M02 validé, +10 points ; avancement 15/100, 2 lots sur 11.
Prochain lot : M03 — orchestration et configuration.**

## Validation M03

**2 octobre 2026 — orchestration et configuration.**

Base du lot : Javapurs `bd7d1f02891f56a9b0e8468d06a21eb810c18a58`, checkout
initial propre. PBO Java : `0f41544464ec0f42e6cb0dd77b206852813f904f` ; fork
PureScript : `3c27d1eeb68d9831e5157eacdae64043c7f45ba8`. Les versions des outils
ont été relevées à nouveau : Node 24.8.0, Spago 1.0.3, même binaire `purs` TAST
que l'inventaire M01 et JDK commun OpenJDK 26.0.2. Aucun override de heap ou de
JDK n'était défini. Les temporaires ont utilisé le dossier `opencode` indiqué
dans les preuves locales ci-dessous.

### Livrables et décisions

- `Main` contient la frontière `argv`/Aff et la mesure totale ; `Config` nomme
  les options de traduction, de pipeline et de sortie ainsi que leurs valeurs
  par défaut. `CodeGen.translateWithIntFunctions` utilise ce type nommé.
- `Driver.compile` expose chargement, préparation et builder PBO ; son callback
  appelle `Ffi`, `Pipeline`, puis `Emit`. `Pipeline.lowerModule` rend explicite
  le contrat traduction → renommage → chunking.
- `Ffi` possède la lecture et le rendu des membres étrangers ; PBO conserve la
  découverte des fragments. `Emit` possède toutes les écritures Java.
- `Runtime` regroupe `__IntFn`, `TcoLoop` et `MainRun`. L'ancien export
  `IntFunctions.runtimeSource` délègue au template commun. `TcoLoop` est écrit
  une seule fois pendant `prepare`, au lieu d'une fois par module ; une entrée
  vide conserve l'inventaire historique avec seulement `__IntFn.java`.
- `Diagnostics` annote les erreurs propagées avec opération, chemin et contexte
  de module. Les libellés et la mesure monotone de `Metrics` sont conservés.
  Les échecs d'écriture de `TcoLoop` appartiennent désormais à `prepare`.
- `bin/javapurs` se remplace par Node avec `exec` et quote la valeur du heap.
  `test/driver.mjs` couvre la CLI réelle et fournit une comparaison avant/après
  à entrées figées. README, guide, matrice et sorties construites sont actualisés.

### Commandes et résultats

| Contrôle ciblé | Résultat |
| --- | --- |
| `./bin/build` | **0 erreur**, 5 avertissements déjà présents dans `CodeGen` ; aucun dans les modules extraits. |
| `node test/driver.mjs --record "$BASELINE"`, avant refactoring | **13 variantes CLI**, entrée vide et six échecs d'I/O attendus ; référence Java enregistrée. |
| `node test/driver.mjs --compare "$BASELINE"`, après refactoring | Mêmes cas réussis ; **102 fichiers Java cumulés**, inventaires et contenus identiques. Diagnostics contextualisés, phases et codes de sortie 1 vérifiés. |
| `node test/int-functions.mjs` | Modes désactivé et activé réussis : interopérabilité, portées, ordre d'évaluation, replis et TCO. |
| `./bin/test DerivingTraversable` | **1 passed, 0 failed** ; **210 modules TAST** inchangés et **331 sources Java** identiques, inventaire inclus. |

La fixture CLI compare chaque variante sur les mêmes TAST et FFI enregistrés
avant extraction du pilote. Le rejeu de `DerivingTraversable` compare les
empreintes des TAST et les octets Java aux sorties du runner partagé avant le
refactoring. Le déplacement de l'écriture de `TcoLoop` modifie sa phase et sa
fréquence, sans modifier son contenu ni l'inventaire final réussi.

Vérifications de clôture : liens/ancres, matrice des 15 suites, correspondance des
sept options documentées avec `Config`, syntaxe des exemples Bash et des entrées
Node/Bash modifiées, score du plan et revue du diff avec `git diff --check`.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m03/`,
notamment `versions.json`, `build-final.log`, `driver-before.log`,
`driver-final.log`, `driver/inputs.json`, `driver/expected/`, `driver/logs/`,
`int-functions.log`, `deriving-traversable.log`, `deriving-comparison.txt`
et `final-checks.txt`.

**Conclusion : M03 validé, +10 points ; avancement 25/100, 3 lots sur 11.
Prochain lot : M04 — AST, parcours et portées.**

## Validation M04

**2 octobre 2026 — AST, parcours et portées.**

Base du lot : Javapurs `af6c50574277e846e86c338d89ff9e0395176727`, checkout
initial propre. Les commits intermédiaires du workspace sont inclus dans la
revue depuis cette base. PBO Java : `0f41544464ec0f42e6cb0dd77b206852813f904f` ;
fork PureScript : `3c27d1eeb68d9831e5157eacdae64043c7f45ba8`.
Versions relevées à nouveau : Node 24.8.0, Spago 1.0.3, même binaire `purs`
TAST que l'inventaire M01, JDK commun OpenJDK 26.0.2. Aucun override de JDK/heap
n'était défini ; les suites isolées ont utilisé le `TMPDIR` approuvé `opencode`.

### Livrables et décisions

- `JavaAst` possède le parcours exhaustif `traverseChildren`, dont dérivent
  `children`, `mapChildren` et `rewriteBottomUp`. Les duplications de `DirectCalls`
  et `Reuse` sont remplacées par ces opérations ; `Rename` ne spécialise que les
  règles de noms et de portées.
- `JavaStaticMethodRef` et `JavaInstanceMethodRef` distinguent les sélecteurs des
  lectures de locaux, champs et propriétés. Leurs producteurs (`CodeGen`,
  `DirectCalls`, `Ownership`, `Operators`, `Chunk`) et le rendu les utilisent.
  Le chunker transporte les captures du récepteur et n'extrait pas un sélecteur seul.
- `Naming` possède les noms partagés des locaux frais, getters, singletons et
  variables de boucle. `Rename` restaure les environnements entre scopes mais
  conserve le compteur ; valeurs, noms de boucle et cibles actives sont distincts.
- `ControlFlow` possède les analyses `hasDirectContinue`, `hasAnyContinue` et
  `hasTargetContinue`. `CodeGen` dépend de cette analyse indépendante du printer.
  Les conditions et indices sont désormais parcourus, avec frontières explicites
  pour les fonctions et boucles imbriquées.
- `Raw` possède le scanner de compatibilité et la reconnaissance limitée des
  formes fermées. Les préfixes de getters et les faux nombres comme `1-e` ne
  suffisent pas à déclarer du texte sans captures. Division et modulo Int dans
  `Operators` exposent leurs binders, lectures et appels `Math` structurellement.
- `test/ast-scopes.mjs`, [le contrat AST](ast.md), README, guide, matrice et
  artefacts construits documentent et vérifient ces responsabilités.

### Défauts reproduits sur la base

Les anciens modules construits ont été chargés depuis la révision de départ,
sans remplacer le checkout courant :

1. Un `JavaLocalAssign "x" (JavaLocal "x")` sous un paramètre homonyme lisait
   son nouveau local. `javac` rejetait `Object x$r1 = x$r1;` avec
   `variable x$r1 might not have been initialized`. L'initialiseur lit désormais
   le binding extérieur ; la même règle vaut pour `JavaIntLocalAssign`.
2. Le remplacement textuel de `JavaRaw` modifiait aussi chaînes, caractères,
   commentaires et noms de membres. Le scanner protège ces régions tout en
   renommant les lectures locales connues ; le texte reste opaque pour Chunk.
3. Une valeur nommée comme la boucle pouvait renommer un `JavaContinue` sans
   changer sa boucle cible. Le programme Java compilait puis laissait échapper
   `TcoLoop`. La résolution par les cibles actives préserve le saut, y compris
   avec une closure et une boucle intermédiaire.

La couverture de `hasAnyContinue` a aussi été confrontée à l'ancienne version :
les sauts dans une condition de ternaire ou un indice de tableau étaient ignorés.
Ces positions sont maintenant incluses par le parcours commun.

### Commandes et résultats

| Contrôle ciblé | Résultat |
| --- | --- |
| `./bin/build` | **0 erreur**, deux avertissements de motifs inaccessibles préexistants dans `CodeGen` ; les imports inutiles touchés ont été retirés. |
| `node test/ast-scopes.mjs` | Assertions AST et **110 contrôles JVM dans chacun des deux modes**, renommage seul puis renommage/chunking. |
| `node test/chunk.mjs` | **11 fixtures** réussies, Java identique à la base. |
| `node test/operators.mjs` | **202 cas numériques** réussis. |
| `node test/direct-calls.mjs` | **37 contrôles runtime par mode**, désactivé puis activé ; sélecteurs et récursion directe vérifiés. |
| `node test/tco.mjs`, `node test/counted-loops.mjs`, `node test/nullary-constructors.mjs`, `node test/typed-records.mjs`, `node test/loop-invariants.mjs`, `node test/int-functions.mjs`, `node test/constructor-reuse.mjs`, `node test/ownership.mjs` | Tous réussis ; modes Int activé/désactivé et frontières de portée/contrôle des consommateurs concernés. |
| `node test/big-function.mjs` | Pipeline isolé réussi et **155 contrôles**, dont 26 motifs non vides entièrement réussis. |
| `./bin/test DerivingTraversable` | **1 passed, 0 failed**, **210 modules TAST** inchangés. |
| Harness local `ChangedArithmeticChecks.java`, `javac --release 17`, puis JVM | **49 contrôles avant et 49 après** sur les trois définitions de bibliothèque dont le Java change. |

### Comparaison du Java

Une sonde locale de `fs.writeFileSync`, chargée par `node --import` dans les
onze suites Java existantes, a conservé les sources avant suppression de leurs
temporaires. Les inventaires correspondent : **64/65 sources identiques**.
Seul `IntegerOperators.java` change pour le rendu structurel de division/modulo ;
les 202 résultats restent conformes. La nouvelle suite ajoute huit sources
cumulées pour ses deux modes, sans référence historique.

Pour `DerivingTraversable`, les empreintes des 210 TAST correspondent à la
référence. Sur **331 sources Java**, **328 sont identiques** ; les fragments FFI
insérés ne changent pas. Les trois différences sont localisées :

| Module et définition | Helpers `__chunk$` avant → après | Cause |
| --- | --- | --- |
| `Data.Monoid.power` | 1 → 2 dans le module | Division/modulo et captures visibles par le chunker. |
| `Data.String.CodePoints.singletonFallback` | 2 → 3 | Arithmétique du couple de substituts Unicode structurée et extractible. |
| `Data.Enum.Generic.genericBoundedEnumProduct` | 7 → 10 | Quotient/reste et closures capturantes désormais extractibles. |

Ces écarts incluent le nouveau rendu des casts/conditions et les helpers
autorisés par les enfants structurels et l'admission des marqueurs `null` fermés.
Le harness compare puissances, codepoints BMP/supplémentaires, énumération d'un
produit, bornes Int, cardinalité nulle et ordre d'appel des deux dictionnaires.
Après la dernière précision de la reconnaissance numérique brute, une nouvelle
génération conserve les **331 sources à l'octet près** par rapport au run déjà
compilé/exécuté ; `ast-scopes` et `chunk` passent à nouveau.

Vérifications de clôture : contrats et consommateurs des nouveaux nœuds, liens
et ancres, matrice des 16 suites, sept options CLI, syntaxe des exemples et des
modules Node concernés, score du plan, revue depuis la base et `git diff --check`.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m04/`,
notamment `versions.json`, `build-final.log`, `before/`, `final/`,
`ast-comparison-final.txt`, `ast-scopes-final.log`, `baseline-regressions.log`,
`control-shadow-before.log`, `big-function-final.log`, `deriving-inputs.json`,
`deriving-before/`, `deriving-final/`, `deriving-comparison-final.txt`,
`deriving-regeneration-final.txt`, les diffs Java, `ChangedArithmeticChecks.java`,
`changed-arithmetic.log` et `final-checks.txt`.

**Conclusion : M04 validé, +10 points ; avancement 35/100, 4 lots sur 11.
Prochain lot : M05 — chunker compréhensible et vérifiable.**

## Validation M05

**2 octobre 2026 — chunker compréhensible et vérifiable.**

Base effective : état de clôture M04, avec HEAD
`05e1be6058d43059ece6b391d2e68755c5ac3abe` et ses modifications non committées.
`base/` dans les preuves conserve les sources/documents, les SHA-256, l'ancien
module Chunk construit, le statut et le diff du checkout. Cette référence
inclut les dernières corrections de portée et de Java brut de M04.
PBO Java et fork PureScript restent aux révisions relevées en M04 ; Node 24.8.0,
Spago 1.0.3, binaire `purs` TAST et JDK OpenJDK 26.0.2 ont été relevés à nouveau.

### Livrables et décisions

- `Chunk.Captures` extrait l'analyse lexicale et ses opérations de combinaison.
  `Captures` distingue ensemble connu et barrière nommée : Java opaque, saut,
  cache de boucle, mutation extérieure, boucle statement ou forme non admise.
  Les séquences partagent le traitement des déclarations et délèguent les
  scopes imbriqués à la même analyse.
- `Chunk.Extraction` nomme `ChunkedValue`, `LocalTypes`, `ResultForm`,
  `ExtractionPlan` et `KeepReason`. `planExtraction` donne une signature typée
  ou le premier motif de maintien. Coûts, budget 256, limite de 64 paramètres,
  pondération des scopes et largeur des groupes sont regroupés ici.
- `Chunk` garde le parcours contextuel et l'état d'émission. `rebuildBlock` et
  `rebuildBranches` partagent la logique des séquences ; `emitHelper` est
  l'allocateur commun aux extractions ordinaires et aux groupes de tableaux.
- L'appel d'un helper conserve les captures de ses arguments ; les paramètres
  reflètent leur type Java effectif. L'absence volontaire des types de bindings
  récursifs dans leurs initialiseurs rend leur refus explicable sans capturer null.
- `test/chunk.mjs` ajoute quatre cas aux limites du coût et des captures,
  exécutés sur la version de départ avant refactoring. Les fixtures existantes
  continuent à contrôler l'évaluation unique et l'identité des groupes de tableaux.
- [docs/chunking.md](chunking.md), guide AST, carte du compilateur, README,
  matrice et artefacts construits sont actualisés.

### Commandes et résultats

| Contrôle ciblé | Résultat |
| --- | --- |
| `./bin/build` | Build incrémental réussi : **0 erreur, 0 avertissement dans les modules reconstruits**. |
| `node test/chunk.mjs`, avant/après | **15 fixtures** réussies, dont 256 unités conservées / 257 extractibles, 64 paramètres admis / 65 refusés. |
| `node test/ast-scopes.mjs`, avant/après | **110 contrôles JVM par mode**, renommage seul puis renommage/chunking. |
| `node test/big-function.mjs`, avant/après | Pipeline isolé réussi, **155 contrôles** dans chaque run, dont 26 motifs non vides entièrement réussis. |
| `./bin/test DerivingTraversable` | **1 passed, 0 failed**. |

Comparaisons à options et outils identiques, inventaires inclus :

- `chunk.mjs` : **16 sources Java identiques**, avec les quatre nouvelles
  fixtures présentes des deux côtés ; `ast-scopes.mjs` : **8 sources identiques**.
- BigFunction : **210 TAST identiques**, source PureScript et configuration Spago
  identiques, **329 sources Java identiques**, ainsi que le harness supplémentaire.
- DerivingTraversable : **210 TAST identiques** et **331 sources Java identiques**
  à la référence issue du dernier run M04.

Soit **684 sources Java cumulées comparées à l'octet près**, hors harness
supplémentaire BigFunction. Les sources Java contiennent les mêmes fragments
FFI. Une sonde locale de validation conserve les écritures des suites AST et
les entrées/sorties BigFunction avant leur nettoyage habituel. Les règles
d'admission, noms, ordre des helpers et coûts produisent les mêmes sorties.

La revue finale vérifie les contrats de coût/captures, les consommateurs et
exports des modules extraits, les chemins et ancres, la matrice des 16 suites,
les sept options CLI, les exemples Bash, la syntaxe Node et le score du plan.
Le diff de M05 est comparé à la copie effective de M04, en plus de
`git diff --check` sur le checkout.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m05/`,
notamment `base/`, `versions.json`, `build-final.log`, `before/`, `after/`,
`ast-comparison.txt`, `big-function-before/`, `big-function-after/`,
`big-function-comparison.txt`, `deriving-before/`, `deriving-after/`,
`deriving-comparison.txt`, les logs des suites et `final-checks.txt`.

**Conclusion : M05 validé, +10 points ; avancement 45/100, 5 lots sur 11.
Prochain lot : M06 — traduction des expressions.**

## Validation M06

**2 octobre 2026 — traduction des expressions.**

Base : Javapurs `17f9b1e3afb000d88d858f54cc8a6a4bd26390ed`, checkout initial
propre. `base/` conserve les sources, tests, documents et l'ancien `CodeGen`
construit. PBO Java : `0f41544464ec0f42e6cb0dd77b206852813f904f` ; fork PureScript :
`3c27d1eeb68d9831e5157eacdae64043c7f45ba8`. Versions relevées à nouveau : Node
24.8.0, Spago 1.0.3, même binaire `purs` TAST et OpenJDK 26.0.2. Aucun override
JDK/heap initial ; les workspaces isolés utilisent le temporaire `opencode`.

### Livrables et décisions

- `CodeGen` possède l'assemblage du module et l'ordre des analyses/passes ; les
  cinq entrées de traduction et la réexportation de `extractUncurriedAbs` sont
  explicites. `CodeGen.Expr` contient le dispatcher exhaustif et ses workers.
- `CodeGen.Context` nomme position terminale, construction/exécution des effets,
  capacités de saut et captures. `Translation` distingue statements ordonnés et
  résultat ; les opérandes gardent leurs statements à leur site d'évaluation.
- `CodeGen.Syntax` regroupe reconnaissance/normalisation des applications,
  abstractions et enveloppes d'effet. Les faits du module restent dans
  `CodegenEnv`, distinct du contexte d'exécution.
- Priorités visibles : ownership pour `App`, puis saut TCO admis, puis application
  primitive/générique. Les chemins uncurried, effets, binders typés et records
  conservent leurs admissions spécifiques. Les représentations de repli ne
  traduisent pas spéculativement les bindings/appels déjà admis ailleurs.
- Les closures conservent les snapshots et perdent les sauts parents. Les joins
  n'activent que des cibles encore vivantes. Une fonction locale qui lit encore
  son propre binding conserve son scope récursif.
- [Le guide des expressions](expressions.md), la matrice, le README et les
  artefacts construits accompagnent les modules et la nouvelle suite `codegen.mjs`.
  Les deux anciens motifs de repli inaccessibles disparaissent au profit des
  dispatchers exhaustifs.

### Défaut d'évaluation reproduit et corrigé

L'ancien `EffectRefWrite` concaténait les statements de ses opérandes, puis
réutilisait ces opérandes avec leurs blocs et réévaluait la valeur pour la
retourner. La nouvelle suite, exécutée sur le `CodeGen` sauvegardé, reproduit
**six échecs sur 48 contrôles** : allocations doublées, résultat distinct de
l'objet stocké, statements rejoués et ordre incorrect, y compris dans deux
écritures successives.

La correction évalue et caste la référence avant la valeur, conserve les deux
résultats dans des locaux structurels, puis écrit et retourne la même valeur.
`Rename` rend ces locaux frais. Les contrôles vérifient aussi l'arrêt avant la
valeur si la référence lève une exception ou échoue au cast, et l'exécution
uniquement au forçage de l'action. Ces primitives sont celles de ST ; la FFI
synchronisée `Effect.Ref` reste une responsabilité distincte.

### Commandes et résultats

| Contrôle ciblé | Résultat |
| --- | --- |
| `./bin/build` | **0 erreur, 0 avertissement** au build final, avec `CodeGen.Expr` et ses consommateurs reconstruits. |
| `node test/codegen.mjs` | **48 contrôles JVM par mode**, renommage puis chunking désactivé/activé ; `javac --release 17`, pile JVM 256 Kio. |
| `node test/int-functions.mjs` | Modes générique et spécialisé : interopérabilité, ordre, exceptions, captures et TCO réussis. |
| `node test/direct-calls.mjs` | **37 contrôles runtime par mode**, appels directs désactivés/activés, et assertions d'admission. |
| `node test/tco.mjs` | **16 cas comportementaux** du contrôle et des captures réussis. |
| `node test/loop-invariants.mjs`, `node test/ownership.mjs`, `node test/typed-records.mjs`, `node test/nullary-constructors.mjs`, `node test/operators.mjs` | Tous réussis ; **202 cas numériques** dans la dernière suite. |
| `node test/big-function.mjs` | Pipeline isolé réussi, puis **155 contrôles**, dont 26 motifs non vides entièrement réussis. |
| `runFixture` ciblé sur `Collatz`, avant/après, puis harness local | Deux pipelines Java 17 réussis sur les mêmes entrées ; **7 résultats de référence avant et après**. |
| `ChangedSTChecks.java`, avant/après | **33 contrôles par version** sur les deux bibliothèques dont le Java change : itérateurs et `monadRecST`, ordre/forçage répété, état et récursion profonde. |

### Comparaison du Java

La sonde locale conserve les sources des suites avant nettoyage. Les huit suites
existantes produisent **50/50 sources identiques**, inventaires inclus. La suite
CodeGen ajoute dix sources cumulées ; sa référence défaillante conservée permet
de localiser la correction dans les fonctions d'écriture.

Pour les deux programmes réels, **210 TAST par programme** sont vérifiés :
Collatz réutilise exactement les mêmes fichiers entre les deux générations ;
BigFunction retrouve les empreintes de la clôture M05, ainsi que sa source,
configuration et harness. Les résultats sont :

| Programme | Sources identiques | Différences |
| --- | --- | --- |
| BigFunction | **327/329** | `Control.Monad.ST.Internal`, `Data.Array.ST.Iterator`. |
| Collatz | **326/329** | Les mêmes bibliothèques, plus `Main.collatz`. |

Les différences correspondent aux locaux d'écriture unique, à leurs suffixes de
renommage et au déplacement d'une frontière de chunk dans `Iterator.iterate`.
Les fragments FFI sont identiques. Le harness ciblé vérifie `next`, `peek`,
`iterate`, `pushWhile`, `pushAll`, l'épuisement et les invocations répétées de
`tailRecM` jusqu'à 100 000 étapes. Après la revue des replis, la dernière génération
conserve les **329 sources de chaque programme** à l'octet près par rapport aux
versions déjà compilées et exécutées.

Vérifications de clôture : exports et consommateurs, absence de traduction
anticipée des replis, liens/ancres, matrice des 17 suites, sept options CLI,
exemples Bash, syntaxe Node, score et revue du diff depuis la base sauvegardée.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m06/`,
notamment `base/`, `versions.json`, `build-final.log`, `before/`, `reviewed/`,
`baseline-final/`, `codegen-baseline-final.log`, `java-comparison-final.txt`,
`collatz-before/`, `collatz-after/`, `collatz-inputs.json`, `big-function-final/`,
`ChangedSTChecks.java`, `st-libraries-before.log`, `st-libraries-after.log`,
`reviewed-generation.txt`, les diffs Java et `final-checks.txt`.

**Conclusion : M06 validé, +10 points ; avancement 55/100, 6 lots sur 11.
Prochain lot : M07 — impression Java et runtime généré.**

## Validation M07

**2 octobre 2026 — impression Java et runtime généré.**

Base effective : clôture M06, HEAD `17f9b1e3afb000d88d858f54cc8a6a4bd26390ed`
avec ses changements non committés. `base/` conserve sources/tests/documents,
empreintes, statut, diff et anciens modules construits Printer/RecordPrinter/Runtime.
Les commits intermédiaires du workspace sont inclus dans la revue depuis cette
copie. PBO Java et fork PureScript conservent les révisions de M06. Node 24.8.0,
Spago 1.0.3, même binaire `purs` TAST et JDK OpenJDK 26.0.2 relevés à nouveau ;
aucun override JDK/heap initial. Temporaires dans le dossier `opencode` approuvé.

### Livrables et décisions

- `Printer` expose un dispatcher exhaustif avec familles expression, statement
  et déclaration identifiables ; ses entrées `printExpr`, `printFile` et
  `escapeJavaString` restent disponibles.
- `Printer.Body` nomme `BodyMode`, `BodyPlan`, `TailContext` et `Loop`. Les
  décisions boucle directe, statements terminaux, bloc/retour ou expression/retour
  précèdent le rendu. Le parcours terminal partage scopes et branches entre
  méthodes et boucles, avec une capacité de `continue` propre au contexte de boucle.
- `Printer.Declarations` regroupe champs eager/lazy, méthodes, classes d'ADT,
  overloads typés/varargs et holders. Initialisation réentrante et conventions
  `Object`/Int conservent leurs templates et conditions.
- `Printer.Syntax` possède l'échappement UTF-16 et les constructions partagées.
  `supplier` crée une action, `forceSupplier` l'exécute. `RecordPrinter` partage
  ces opérations et sépare déclarations, lecteurs, membres Map et évaluations
  des champs/mises à jour.
- `Runtime.builtinGlobalSource` rassemble les cinq implémentations globales
  intégrées auparavant dans `Printer`. Les trois templates de fichiers communs
  gardent leur contenu. Les sous-renderers reçoivent un callback `Render`, sans
  dépendance circulaire sur le dispatcher.
- [Guide du rendu](printing.md), carte du compilateur, contrat AST, README,
  matrice, suite `printer.mjs` et modules construits sont actualisés.

### Défaut d'échappement reproduit

Avant refactoring, les **75 contrôles de valeurs/corps** de la nouvelle suite
passent, puis `javac` rejette `PrinterMessages.java` : les messages de `JavaThrow`
et les identités de `TcoLoop` étaient insérés sans échappement. Guillemets,
backslashes, retours à la ligne et séquences textuelles `\u000a` produisaient du
Java invalide. Les fichiers et le log d'échec sont conservés.

Ces sites passent maintenant par `quote`, comme les littéraux et labels de
records. Les **11 contrôles supplémentaires** vérifient les messages exacts et
un saut à travers le repli `TcoLoop` avec une cible contenant des caractères à
échapper. Les attentes Java sont construites par codes UTF-16, indépendamment
du renderer, et couvrent aussi Unicode supplémentaire et substituts isolés.

### Commandes et résultats

| Contrôle ciblé | Résultat |
| --- | --- |
| `./bin/build` | **0 erreur, 0 avertissement** ; modules du rendu et consommateurs reconstruits. |
| `node test/printer.mjs` | **86 contrôles JVM** : 75 valeurs/corps et 11 messages/cibles ; Java 17, pile 256 Kio. |
| `node test/tco.mjs`, `node test/counted-loops.mjs`, `node test/loop-invariants.mjs` | Réussis : contrôle terminal, chemins comptés/génériques, captures et caches. |
| `node test/direct-calls.mjs`, `node test/int-functions.mjs` | Réussis dans les modes concernés ; **37 contrôles runtime par mode** pour les appels directs. |
| `node test/nullary-constructors.mjs`, `node test/typed-records.mjs`, `node test/ownership.mjs`, `node test/constructor-reuse.mjs` | Déclarations, ABI, initialisation, records et mutation/réutilisation réussis. |
| `node test/operators.mjs` | **202 cas numériques** réussis. |
| `node test/chunk.mjs`, `node test/ast-scopes.mjs`, `node test/codegen.mjs` | **15 fixtures**, **110 contrôles JVM par mode** et **48 contrôles JVM par mode**, respectivement. |
| `node test/big-function.mjs` | Pipeline isolé réussi, puis **155 contrôles**, dont 26 motifs non vides entièrement réussis. |

### Comparaisons

- Les treize suites existantes ont été exécutées avant/après avec la sonde locale
  de conservation des sources : **87/87 sources Java identiques**, inventaires inclus.
- La nouvelle suite Printer produit **6/7 sources identiques** à sa référence
  initiale ; seul `PrinterMessages.java` change pour la correction décrite ci-dessus.
- BigFunction conserve ses **210 TAST**, sa source PureScript, sa configuration
  et son harness par rapport à la clôture M06. Ses **329/329 sources Java**, FFI
  incluse, sont identiques. Les frontières de corps, de branches et de chunking
  conservent ainsi les sorties du grand arbre de gardes.
- Les templates `__IntFn`, `TcoLoop` et `MainRun` sont comparés directement aux
  exports Runtime sauvegardés ; leur contenu est identique.

Soit **416 sources Java existantes comparées à l'octet près**, plus les sept
sources de la nouvelle suite, dont une correction explicite. La validation
finale contrôle également exports/consommateurs, absence de rendu anticipé des
chemins non choisis, liens et ancres, matrice des 18 suites, sept options CLI,
exemples Bash, syntaxe Node, score et diff depuis la base effective M06.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m07/`,
notamment `base/`, `versions.json`, `build.log`, `build-final.log`, `before/`,
`after/`, `baseline-regression/`, `printer-baseline-result.log`,
`004-PrinterMessages.java.diff`, `java-comparison.txt`, `big-function-after/`,
`big-function-inputs.json`, `big-function-comparison.txt`, les logs des suites,
`runtime-comparison.txt`, `effective-m07.diff` et `final-checks.txt`.

**Conclusion : M07 validé, +10 points ; avancement 65/100, 7 lots sur 11.
Prochain lot : M08 — types, représentations et conventions d'appel.**

## Validation M08

**2 octobre 2026 — types, représentations et conventions d'appel.**

Base effective : clôture M07, HEAD `7acf2dc4717be7ae7808a1f2958444433af34b8f`
avec les changements de rendu/documentation encore non committés. `base/`
conserve les sources, documents et modules construits de cette référence ; le
statut et le diff initiaux sont enregistrés séparément. La nouvelle fixture
`representations.mjs` y a également été copiée pour son exécution comparative.
PBO Java : `0f41544464ec0f42e6cb0dd77b206852813f904f`. Checkout PureScript relevé :
`13f63fdde1a82cfe91ae1ccf847784d2fbbbfafb` ; binaire `purs` du PATH toujours
`0.15.16 [development build; commit: 3c8fcfd7a3d440bba487fe9fe059284cffc6e908 DIRTY]`.
Node 24.8.0, Spago 1.0.3 et OpenJDK 26.0.2 ; aucun override JDK/heap initial.
Le lien `b8x/output` relevé pointe vers `run/bak/rust/output`.

### Livrables et contrats

- `TypeEvidence` possède les projections de types déclarés, les environnements
  lexicaux, la consommation de flèches et les propriétés de records. Les trois
  implémentations de consommation de `Func` sont réunies ; `RecordTypes` et
  `FunctionTypes` gardent leurs règles de propagation spécifiques.
- `Representation` possède la sélection du stockage Int/Object des champs et
  paramètres, l'admission des signatures récursives par arité exacte, les
  catégories de champs de records et la conversion des arguments de workers.
  `CodeGen` et `DirectCalls` emploient ce contrat commun. Les réexports existants
  `FunctionTypes.intFunction` et `CodeGen.Syntax.paramKinds` sont conservés.
- `IntFunctions` consomme la même preuve résiduelle pour abstraire et appliquer.
  Les barrières `TypeApp`, `ForAll` et contraintes, le préfixe récursif boxed et
  l'adaptation des callbacks à l'invocation sont documentés à leurs entrées.
- `RecordPrinter.fieldStorage` rassemble type Java, conversion depuis Object et
  test de compatibilité de mise à jour. `Printer.Syntax.unboxInt` est partagé par
  lecteurs/champs de records et constructeurs ADT génériques. `JavaParamType`
  distingue explicitement preuve de stockage et type Java effectif d'une closure.
- [Guide des représentations](representations.md), liens des autres guides,
  matrice, fixture de conventions et artefacts construits sont livrés ensemble.
  Le guide relie TAST/PBO/annotations/Java, explique les informations insuffisantes
  et nomme les obligations des FFI pour wrappers, callbacks, ADT et Maps.

### Commandes et résultats

| Contrôle ciblé | Résultat avant/après |
| --- | --- |
| `./bin/build` | **0 erreur, 0 avertissement** ; 30 modules reconstruits après extraction des contrats. |
| `node test/representations.mjs` | **43 contrôles JVM × 8 modes**, soit **344 par version** ; même `BackendModule`, même harness Java, `javac --release 17`. |
| `node test/int-functions.mjs` | Modes générique/spécialisé réussis : bridge FFI, valeurs nulles, exceptions, captures, flèches et récursion. |
| `node test/typed-records.mjs`, puis `node test/typed-records.mjs --records=maps` | **75 / 69 contrôles JVM**, respectivement, sur les mêmes fixtures. |
| `node test/nullary-constructors.mjs`, `node test/constructor-reuse.mjs` | Singletons, initialisation, champs frais et **7 groupes** de réutilisation réussis. |
| `node test/direct-calls.mjs`, `node test/ownership.mjs` | **37 contrôles par mode** pour les appels directs ; workers, polymorphisme, groupes locaux et mutations ownership réussis. |
| `node test/printer.mjs`, `node test/chunk.mjs`, `node test/int-loops.mjs` | **86 contrôles JVM**, **15 fixtures** et **25 cas de classification**, respectivement. |
| `node test/driver.mjs --record "$REF"`, puis `--compare "$REF"` | **13 variantes CLI**, **12 exécutions JVM**, entrée vide et six erreurs d'I/O attendues réussies ; TAST/FFI figés et vérifiés par SHA-256. |

`REF` désigne ici le dossier local `javapurs-m08/driver-reference`, inexistant
avant `--record`. Les commandes de la table ont été exécutées une fois avec la
référence et une fois avec les modules reconstruits, sauf le build lui-même.
La nouvelle fixture traverse le pipeline traduction/renommage avec chunking
désactivé ; `chunk.mjs` et le pilote couvrent séparément le transport des types
effectifs dans les helpers.

### Comparaisons et clôture

- Dix exécutions de suites existantes (neuf scripts, records dans deux modes) :
  **74/74 sources Java identiques**, inventaires inclus.
- Nouvelle fixture de conventions, exécutée aussi sur le backend sauvegardé :
  **28/28 sources identiques**, avec les huit configurations.
- Pilote sur les quatre modules TAST figés, mêmes options et FFI :
  **102/102 sources Java identiques**.

Soit **204 sources Java cumulées identiques à l'octet près**, dont 176 issues
des suites existantes. Aucun changement de comportement n'a été nécessaire
pour ce lot. La revue finale vérifie exports/consommateurs, liens et ancres,
matrice des 19 suites, sept options CLI, exemples Bash, syntaxe Node, score et
diff depuis la base effective M07.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m08/`,
notamment `base/`, `environment.txt`, `status-before.txt`, `diff-before.patch`,
`build.log`, `before/`, `after/`, `comparison-existing.json`,
`comparison-representations.json`, `driver-reference/inputs.json`, les logs des
suites/pilote, `effective-m08.diff` et `final-checks.txt`.

**Conclusion : M08 validé, +10 points ; avancement 75/100, 8 lots sur 11.
Prochain lot : M09 — passes spécialisées.**

## Validation M09

**2 octobre 2026 — passes spécialisées.**

Base effective : clôture M08, HEAD `7acf2dc4717be7ae7808a1f2958444433af34b8f`
avec M07/M08 encore non committés. Les empreintes `final-source-hashes.json` de
M08 ont été vérifiées avant copie des sources, documents et modules construits
dans `base/`. Un commit intermédiaire a déplacé le HEAD à
`512935246e73bbb4b07ce21dae8dc1a8f96a1167` pendant le lot ; les comparaisons
restent fondées sur cette sauvegarde effective et son diff initial.

PBO Java : `0f41544464ec0f42e6cb0dd77b206852813f904f`, checkout propre.
Checkout PureScript relevé à la clôture : `b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16` ;
binaire `purs` du PATH toujours
`0.15.16 [development build; commit: 3c8fcfd7a3d440bba487fe9fe059284cffc6e908 DIRTY]`.
Node 24.8.0, Spago 1.0.3, JDK commun OpenJDK 26.0.2 ; aucun override JDK/heap.
Les workspaces utilisent le dossier temporaire `opencode`. Le lien `b8x/output`
relevé pointe vers `run/bak/rust/output`.

### Livrables et décisions

- `Ownership.prepare` conserve l'orchestration. Le monolithe de 959 lignes est
  réparti entre `Candidates` (sélection/signatures/noms), `Model` (IR/chemins),
  `Analysis` (usages/alias/fraîcheur), `Cells` (snapshots/retrait/pools) et
  `Workers` (écritures/scopes/boucles/déclarations), avec exports explicites.
- La validation atteint un point fixe avant de réécrire les appels frais et de
  fermer les dépendances atteignables. Les déclarations validées du dernier
  graphe sont conservées avec leur candidat, au lieu d'être régénérées à
  l'émission. Le helper `hasTermContinue`, sans consommateur, a été retiré.
- `DirectCalls.admitCall` produit un `CallPlan` pur. Le parcours réécrit les
  enfants, applique ce plan et note les workers utilisés ; l'émission partage
  le wrapper eager/lazy et reprend les corps déjà réécrits. Les gardes
  d'initialisation et les frontières d'application restent explicites.
- `PureInvariants` utilise `TypeEvidence.applyArguments` ; `LoopInvariants`
  expose `LoopPlan`. Les petites passes `IntLoops`, `CountedLoops` et `Reuse`
  conservent leur découpage existant, jugé adapté après revue. Le guide précise
  notamment que `Printer.Body` vérifie la cible du plan compté avant rendu.
- [Guide des passes spécialisées](specialized-passes.md), carte du compilateur,
  conventions de littéraux, recettes, matrice et artefacts construits actualisés.
  Les limites de découpage ownership sont documentées : **6000 caractères
  imprimés**, pas une garantie de bytecode ni d'inlining HotSpot.

### Deux défauts reproduits puis corrigés

**Littéraux dans les workers.** Sur le backend sauvegardé,
`ownership-admission.mjs --simple-scalars` réussit les huit contrôles persistants,
puis échoue sur `Char is a String` avec ownership. Le chemin consommateur boxait
un `char` Java en `Character`, alors que l'ABI attend une `String`. La fixture
complète révèle aussi les caractères non échappés ; ses workers contiennent
les identifiants Java invalides `NaN`/`Infinity` et perdent le signe de `-0.0`.
`Literals.charLiteral` et `numberLiteral` sont désormais partagés par
`CodeGen.Expr` et `Ownership.Analysis`. Le chemin ordinaire conserve son rendu.

**Auto-appels sous alias.** Sur la référence, `ownership-loops.mjs` réussit les
neuf contrôles persistants, puis les trois workers consommateurs échouent à
`javac`. La détection initiale essayait de prouver les arguments avec un
environnement qui ne contenait pas encore les alias `let`, et ignorait `LetRec`.
L'émission produisait ensuite un saut sans avoir installé la boucle. Le choix
du scope de boucle utilise maintenant la cible de l'appel connu ; les arguments
restent intégralement validés dans l'environnement de snapshots avant admission.

### Commandes et résultats

| Contrôle ciblé | Résultat |
| --- | --- |
| `./bin/build` | **0 erreur, 0 avertissement** après refactoring et après les corrections. |
| `node test/direct-calls.mjs` | **37 contrôles JVM par mode** et assertions d'admission. |
| `node test/int-loops.mjs`, `node test/counted-loops.mjs` | **25** classifications Int, **51** admissions/refus comptés ; exécution des échanges, overflow, effets et repli négatif réussie. |
| `node test/loop-invariants.mjs` | **23** preuves/refus de pureté, **13** contrôles de portée, **50** comportements de cache. |
| `node test/constructor-reuse.mjs`, `node test/ownership.mjs` | **7 groupes** de réutilisation ; arbres, listes polymorphes, workers locaux et capture scalaire réussis. |
| `node test/tco.mjs`, `node test/chunk.mjs` | **16** cas de contrôle et **15** fixtures de chunking. |
| `node test/representations.mjs` | **43 contrôles JVM × 8 modes**, soit **344 par version**. |
| `node test/printer.mjs` | **86 contrôles JVM** ; rendu commun des littéraux, corps et templates. |
| `node test/ownership-admission.mjs` | **11** admissions/refus ; **28** contrôles JVM persistants et **31** avec ownership. |
| `node test/ownership-loops.mjs` | **9 contrôles JVM par mode**, avec 0/1/100 000 itérations et pile de 256 Kio. |

Les dix suites existantes ont été exécutées sur la référence sauvegardée et le
backend refactoré. Les deux nouvelles suites ont d'abord reproduit leurs échecs
sur cette référence, puis réussi après correction. Leurs AST, options, harnesses
et helpers Java ont été conservés pour comparaison ; aucune FFI externe n'est
nécessaire. Le rejeu après la correction des boucles couvre les suites ownership,
appels directs, invariants, représentations, TCO et chunking concernées.

### Comparaisons et clôture

- Refactoring seul, avant correction comportementale : **67/67 sources Java
  identiques** sur les neuf premières suites, inventaires compris.
- Version corrigée, avec la suite printer : **74/74 sources existantes identiques**.
- Nouvelles fixtures : **16/18 sources identiques**. Les deux écarts sont limités
  au module des littéraux avec ownership et au module des boucles avec ownership ;
  les variantes persistantes, harnesses et helpers gardent leurs octets.

La revue finale confronte les fonctions extraites à leur définition initiale,
contrôle exports/consommateurs et suppression du seul helper inutilisé, puis
vérifie liens/ancres, matrice des **21 suites**, sept options CLI, exemples Bash,
syntaxe Node, score et diff depuis la base effective M08.
Résultat : **298 liens/ancres**, **21 exemples Bash** et **13 entrées Node**
vérifiés ; score recalculé et `git diff --check` réussis.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m09/`,
notamment `base/`, `environment-final.json`, `head-before.txt`, `status-before.txt`,
`diff-before.patch`, `build-refactor.log`, `build-final.log`, `build-loops.log`,
`before/`, `refactor/`, `after/`, `corrected/`, les logs d'échecs
`simple-scalars-baseline.log`, `all-scalars-baseline.log`, `loops-baseline.log`,
les diffs des deux nouvelles fixtures, `comparison-existing.json`,
`effective-m09.diff` et `final-checks.txt`.

**Conclusion : M09 validé, +10 points ; avancement 85/100, 9 lots sur 11.
Prochain lot : M10 — contrats FFI et runtimes des ports.**

## Validation M10

**3 octobre 2026 — contrats FFI et runtimes des ports.**

Références initiales, après vérification des empreintes de clôture M09 ; les cinq
checkouts étaient propres et leurs sources ont été sauvegardées dans `base/` :

| Dépôt | Révision de départ |
| --- | --- |
| Javapurs | `eba169d42727ec1a9065235262c20b74c665f781` |
| Aff | `6965604bb7a26cd3836a30cf538bdd8b3ff058d5` |
| Refs | `753153553468d12c415590af69bf9b935bc77147` |
| Promise | `3af76a1273a16cb5e08dfd7dd6593fdc6f51cc8a` |
| Promise/Aff | `26930357ef0d7dcbe0bab466612e67406081f0ed` |

Outils relevés : Node 24.8.0, Spago 1.0.3, binaire `purs` TAST de l'inventaire
M09, OpenJDK 26.0.2. Aucun override JDK/heap initial ; les nouvelles suites
ciblent **Java 17**. Les temporaires utilisent le dossier `opencode` approuvé.

### Responsabilités et livrables

- Revue de `Ffi`/`Emit` et du résolveur PBO : leur découpage existant suffit.
  Le [guide FFI/runtime](ffi-runtime.md) décrit découverte, insertion/stubs,
  noms, wrappers curryfiés, effets différés, conversions, JAR et durées de vie.
- `Effect/Aff.java` sépare interprétation, inscriptions, réservation/achèvement
  de l'annulation, résultat/observateurs des fibres, bracket et coordination
  parallèle. Les wrappers FFI utilisent ces propriétaires nommés. Les moniteurs
  protègent les transitions ; les callbacks/cancelers s'exécutent hors verrou.
- `Promise/Internal.java` sépare règlement/adoption, distribution trampolinée,
  coordination `all`/`race` et wrappers. Les réactions restent eager ; les états
  pending/réglé, la première décision et les erreurs de callbacks sont explicites.
  La vue publique `PromiseValue` utilisée par la FFI applicative est conservée.
- Ref conserve son implémentation courte et synchronisée ; ses commentaires
  précisent atomicité et compatibilité Map. Le commentaire de `Promise.Rejection`
  distingue rejet arbitraire et reconnaissance d'un Throwable. Le pont reste
  porté par son module PureScript, dont le guide précise les limites d'annulation.
- Deux suites ciblées, harness Java, fixture PureScript/FFI et quatre launchers
  `bin/test-runtime` rendent ces contrats rejouables. README du compilateur et des
  ports, carte, matrice et suivi sont actualisés ensemble.

### Défauts reproduits et corrections

La première série de protocoles a été exécutée avant la réorganisation :
**Ref 4 réussites**, **Promise 9 échecs/1 réussite**, **Aff 10 échecs/0 réussite**.
Les logs isolent les règles rompues : lecture de Promise pending comme un succès,
absence d'adoption et de capture des exceptions, course ignorant un premier
rejet, finalisation sans attente ; joins tardifs perdus, désabonnement bloquant,
isSuspended incorrect, cancelers conservés ou mal appliqués, map récursif,
nettoyage multiple et confusion entre succès Unit et absence de gagnant.

Les contrôles supplémentaires couvrent annulation pendant inscription/acquisition,
appels concurrents, nettoyages avant publication, propagation aux deux branches,
supervision des petits-enfants et des forks à la fermeture, abonnements concurrents
et chaînes profondes. La revue finale a reproduit une publication incohérente de
la cause sur une fibre suspendue (**1 échec/17 réussites**), puis séparé réservation
de la cause et exécution des cancelers sous le verrou de cycle de vie de la fibre.

L'intégration est d'abord restée suspendue à la conversion du rejet Promise/Aff.
Les traces de phases et une sonde de `Promise.Aff.coerce` ont montré un stub
`Foreign` : le workspace sélectionnait le package du registre plutôt que son
port Java. L'ajout explicite de `javapurs-foreign` à cette fixture corrige sa
configuration transitive. Les succès et rejets passent ensuite dans les deux
représentations de records.

Les quatre anciens `bin/test` avaient retourné 0, mais Aff/Promise-Aff quittaient
avant leurs assertions daemon. Le test Promise utilisait des timers déjà réglés
et ne propageait pas tous les rejets de ses assertions. Ces codes initiaux sont
conservés comme constat, pas comme preuve asynchrone. Les nouvelles suites
attendent la complétion et contrôlent le résultat de chaque contrat.

### Commandes et résultats

| Contrôle ciblé | Résultat final |
| --- | --- |
| `node test/ffi-runtimes.mjs` | **36 contrôles** : Ref 4, Promise 14, Aff 18 ; compilation Java 17 et exécution avec pile 512 Kio. |
| `bin/test-runtime` de Refs, Promise et Aff, depuis chaque port | Respectivement **4**, **14** et **18** ; résolution du script/JDK et groupes vérifiés. |
| `../javapurs-js-promise-aff/bin/test-runtime` | Appelle `ffi-ports.mjs` : **17 assertions × 2 modes**, records typés puis Maps sur le même TAST ; phases PureScript/génération/javac/JVM réussies. |
| Sonde de la vraie FFI `Main.awaitAff` avec un Aff défaillant | **Code JVM 1 attendu**, message d'échec asynchrone retrouvé ; aucun retour réussi prématuré. |
| `node test/driver.mjs` | **13 variantes CLI**, **12 exécutions JVM**, entrée vide et six échecs d'I/O attendus ; fragments fournis, vides et absents contrôlés. |
| Régénération des quatre ports depuis leurs TAST initiaux, puis `javac --release 17` | Quatre compilations réussies ; entrée historique synchrone Ref également exécutée avec code 0. |

Les changements de runtime sont compilés directement à partir des fragments.
Les sources du backend conservent le build validé de M09 ; les comparaisons
utilisent ce même compilateur et les mêmes options `--main Test.Main`.

### Comparaison Java et clôture

Les sorties des quatre runs initiaux ont été capturées dans `generated-before/`.
Leur TAST conservé a été copié dans des workspaces de comparaison ; les empreintes
de **931 modules TAST cumulés** sont vérifiées avant/après génération, sans relancer
Spago. Les dépendances et chemins de résolution restent ceux des runs initiaux.

| Port | Sources Java | Identiques | Différences limitées aux fragments FFI |
| --- | ---: | ---: | --- |
| Refs | 269 | 268 | Commentaires de `Effect.Ref`. |
| Promise | 401 | 398 | `Promise.Internal`, commentaires de `Promise.Rejection` et `Effect.Ref`. |
| Aff | 373 | 371 | `Effect.Aff`, commentaires de `Effect.Ref`. |
| Promise/Aff | 437 | 433 | Les quatre fragments précédents. |
| **Total** | **1 480** | **1 470** | **10 fichiers**. |

Pour chacun des dix fichiers, remplacer uniquement le nouveau fragment par sa
copie initiale restitue exactement les octets de la référence. Inventaires,
déclarations PureScript générées, helpers, chunking et conventions d'appel sont
donc identiques sur ces entrées. Les sorties suivies d'Aff modifiées par le run
historique initial ont été sauvegardées puis remises dans leur état d'entrée.

La clôture vérifie liens/ancres, matrice des **23 suites**, exemples Bash,
syntaxe des nouvelles entrées Node/Bash, caractère exécutable des launchers,
recalcul du score et revue des diffs des cinq dépôts. Les preuves comprennent
les empreintes finales des sources concernées et `git diff --check`.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m10/`,
notamment `base/`, `versions.json`, `*-protocol-before.log`,
`fiber-cause-before.log`, `protocol-final.log`, `*-launcher-final.log`,
`coercion-baseline.log`, `integration-phases.log`, `integration-final.log`,
`integration-failure-propagation.log`, `driver-final.log`, `generated-before/`,
`generation-workspace/`, `compare-java.py`, `java-comparison.json`,
`*-tast.json`, `*-javac-after.log`, `final-source-hashes.json` et `final-checks.txt`.

**Conclusion : M10 validé, +10 points ; avancement 95/100, 10 lots sur 11.
Prochain lot : M11 — consolidation et entretien du dépôt.**

## Validation M11

**3 octobre 2026 — consolidation et entretien du dépôt.**

Référence effective : clôture M10, **138 empreintes** de sources/documents/outils
vérifiées avant sauvegarde dans `base/`. Les cinq dépôts avaient encore les
changements M10 sur les HEAD indiqués dans ce lot. Pendant la revue, les commits
du workspace ont intégré ces changements ; les 138 empreintes ont été vérifiées
à nouveau sans différence :

| Dépôt | Révision après intégration de M10 |
| --- | --- |
| Javapurs | `29f3205c056df32e8de55a43f11e9c6a952f3d2d` |
| Aff | `f3138ad666d4761a9f1a3517a5980266916ec860` |
| Refs | `228bb557d2ade1f978146361dc40e3d775d53fd3` |
| Promise | `ee51b43d708f52375fa83c9d51bc659e4774213b` |
| Promise/Aff | `a48f268639ac300ac21afc0e096c6171819bdfe1` |

Les contrôles emploient Node 24.8.0, Bash, Git et, pour le pilote ciblé, le même
`purs` TAST/OpenJDK 26.0.2 que M10, avec `javac --release 17`. Les preuves et
restaurations isolées sont dans le dossier temporaire `opencode` approuvé.

### Revue et décisions

- Les **46 modules actifs** ont des exports explicites, des imports internes
  résolus et un graphe de dépendances acyclique. Les façades de `CodeGen`,
  `Printer`, `IntFunctions`, `FunctionTypes` et `CodeGen.Syntax` ont été reliées
  à leurs propriétaires/consommateurs. Les replis de portée, Maps/Object,
  appels curryfiés, TcoLoop et refus d'optimisation ont un contrat identifié.
- Le [guide de reprise et d'entretien](maintenance.md) rassemble ce parcours,
  le statut des sources/sorties/caches, la politique des journaux, les références
  de restauration et les points techniques ouverts après le plan. README,
  carte du compilateur, matrice et TODO y renvoient.
- `tools/check-docs.mjs` transforme le contrôle documentaire ponctuel des lots
  précédents en commande versionnée : liens/ancres locaux, exemples Bash,
  inventaire des suites, options de `Config`, score et présence des preuves.
  Il retrouve le dépôt depuis son URL et utilise Node/Bash sans build préalable.
- Les `.purs.bak` d'août et `output.bak` ont été examinés dans les sources,
  configurations, launchers et outils. Leur ancien schéma/build 0.15.15 ne
  participe pas au chemin courant. Les copies propres et intégralement suivies
  ont été retirées après restauration vérifiée depuis Git : **2 154 fichiers**,
  **57 649 356 octets**. Le nouveau `.gitignore` cible seulement ces formes de
  sauvegarde. Le commit de récupération et les trois objets Git sont documentés.
- Les **118 journaux** locaux ont un inventaire et des empreintes conservés ;
  leurs résultats historiques sont distingués des validations datées du registre.
  Les artefacts `output`, Spago, REPL et runner ont leur producteur et leur statut
  de versionnement documentés.

### Vérifications ciblées

| Contrôle | Résultat |
| --- | --- |
| `node tools/check-docs.mjs` | **16 documents**, **23 suites**, **7 options CLI**, score **100/100**, liens/ancres et syntaxe des exemples shell contrôlés. |
| Six contre-exemples dans une copie isolée des documents | Lien absent, ancre absente, syntaxe Bash invalide, suite omise, option omise et score erroné : **six codes 1 attendus**, chacun avec le diagnostic correspondant. Appel depuis un autre dossier également réussi. |
| `node --check tools/check-docs.mjs` | Syntaxe valide. |
| `node test/driver.mjs`, après retrait des sauvegardes | **13 variantes CLI**, **12 exécutions JVM**, entrée vide et six erreurs d'I/O attendues réussies ; le chemin de compilation courant s'exécute après nettoyage. |
| Archive/restauration des sauvegardes depuis `eba169d…` | **2 154/2 154** chemins, tailles et SHA-256 identiques, y compris les externs binaires. |
| Revue des interfaces et empreintes actives | **46/46** sources PureScript identiques à la clôture M10 ; exports/imports contrôlés. Les sorties construites et les fichiers suivis Spago/REPL/runner n'ont pas de diff. |
| Règles Git et journaux | Les formes `.purs.bak`/`output.bak` sont ignorées, les sources/builds actifs restent sélectionnables ; **118 journaux** conservés à l'identique. |
| Score, changements et espaces | 11 cases, somme des poids 100, revue des suppressions/restaurations et `git diff --check` réussis. |

Cette clôture valide l'organisation, la reprise et l'entretien du plan v1.
Les acquis d'exécution et comparaisons Java de M01–M10 gardent leurs preuves
datées ; les sujets futurs sont indexés dans les
[points ouverts](maintenance.md#points-ouverts-après-le-plan).

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m11/`,
notamment `base/`, `m10-input-verification.json`, `intermediate-revisions.json`,
`module-interfaces.json`, `archive-verification.log`, `legacy-snapshots.json`,
`legacy-snapshots.tar.gz`, `restored-snapshots/`, `logs-before.json`,
`source-artifact-review.log`, `check-docs-probes.log`, `check-docs-final.log`,
`driver-final.log`, `final-source-hashes.json` et `final-checks.txt`.

**Conclusion : M11 validé, +5 points ; avancement 100/100, 11 lots sur 11.
Plan v1 terminé — entretien courant guidé par les contrats et la matrice ciblée.**

## Validation M12

**3 octobre 2026 — suites asynchrones avec résultat de processus fiable.**

Premier lot du plan v2. Références de départ : Javapurs
`29f3205c056df32e8de55a43f11e9c6a952f3d2d`, Aff
`f3138ad666d4761a9f1a3517a5980266916ec860`, Promise
`ee51b43d708f52375fa83c9d51bc659e4774213b` et Promise/Aff
`a48f268639ac300ac21afc0e096c6171819bdfe1`. Le workspace comportait déjà les
changements documentaires/nettoyages M11 et le nouveau TODO v2. `before.json`
et `base/` conservent les références effectives et les fichiers examinés.

### Changements et défauts exposés

- Les trois `bin/test` délèguent à `test/port-runners.mjs` et
  `tools/port-test-runner.mjs`. Préparation depuis le template Spago commun,
  sélection explicite des ports transitifs dont `foreign`, copie des tests dans
  un temporaire, logs et timeout par phase, paire JDK commune. `Test.Bench` reste
  une entrée de benchmark distincte.
- `tests/port-suites/` possède les entrypoints `Test.PortRunner` : attente bornée
  d'une fibre supervisée ou de la Promise retournée par la suite. Le succès
  demande le code 0, un marqueur final unique et le nombre prévu de contrôles.
  Les sondes réutilisent ce même code compilé et la même frontière d'attente.
- L'attente des tests Aff a exposé **`kill/supervise`**, puis **`parallel/mixed`** :
  leurs attentes supposaient des forks eager et un ordre stable entre petits
  timers. Des rendez-vous, joins et comparaisons d'événements indépendants de
  l'ordre remplacent ces hypothèses dans les cas concernés ; les finalizers sont
  attendus. Les cinq premières assertions font désormais partie de la même
  suite Aff. Le parallèle est borné à **64 branches**, en accord avec les threads
  ordinaires ; l'ancien test de scheduler à 100 000 forks reste désactivé et les
  contrôles de trampoline profonds restent dans la suite directe M10.
- Promise retourne une chaîne unique qui observe toutes les assertions,
  les rejets et les nettoyages. Les issues attendues sont converties avant les
  assertions : un `catch` ne peut plus absorber son propre échec d'assertion.
  `all`/`race` s'abonnent à des valeurs pending réglées explicitement ; le perdant
  de la course est observé. Les FFI de timers Java et JS règlent réellement leurs
  Promises plus tard, avec le même résultat ou message d'erreur.
- Promise/Aff expose sa suite attendue et dispose enfin du fragment de test
  `test/Main.java` pour ses quatre imports foreign. Les contrôles de round-trip
  ont une borne de 5 s adaptée à la création de threads JVM.
- `TestProcesses` peut conserver silencieusement les diagnostics des échecs
  attendus (`reportFailure: false`) tout en rejetant la commande. Sa suite vérifie
  code et log. Un échec préalable de son contrôle JDK, dû à l'alias macOS
  `/var` → `/private/var`, a été corrigé en canonicalisant le temporaire du test.

### Vérifications ciblées

Backend construit de M10, Node **24.8.0**, Spago **1.0.3**, frontend TAST du fork
et OpenJDK **26.0.2** ; compilation Java des suites en **`--release 17`**.
Les sources de tests des ports sont recompilées dans chaque workspace isolé.

| Contrôle | Résultat |
| --- | --- |
| `../javapurs-aff/bin/test` | **45 contrôles** et quatre sondes de runner réussis. |
| `../javapurs-js-promise/bin/test` | **13 contrôles** et quatre sondes de runner réussis, dont rejet issu d'une assertion après un vrai timer. |
| `../javapurs-js-promise-aff/bin/test` | **7 contrôles** et quatre sondes de runner réussis, avec FFI Java et port `foreign` locaux. |
| Cinq rejeux JVM des mêmes classes Aff après correction des hypothèses de scheduling | **225 contrôles**, cinq marqueurs finaux ; les classes et les entrées sont conservées dans `aff/`. |
| Sondes de fin de processus, sur les trois suites | **9 codes JVM 1 attendus** : assertion tardive, rejet et timeout ; **3 sorties prématurées 0** correctement rejetées par le contrôle du marqueur. |
| `node test/ffi-ports.mjs` | **17 assertions × 2 modes**, records typés puis Maps sur les mêmes TAST ; pont réel, nettoyage et attente de la fibre réussis. |
| `node --test test/test-tools.mjs` | **11/11**, y compris logs d'échec silencieux, sélection JDK, timeout et propagation des signaux aux descendants. |
| Deux sélections invalides des launchers avec JDK/TMPDIR volontairement absents | **Codes 1 attendus** avant toute phase de build ou préparation de workspace. |
| Empreintes des artefacts actifs | **3 825 fichiers** de sources runtime/backend, sorties, dépendances suivies et configurations identiques à l'entrée M12 ; changements des ports limités aux tests/launchers/README. |
| Syntaxe et documentation | Syntaxe Node/Bash, liens/ancres, inventaire de **24 suites**, sept options CLI, score **20/100** et `git diff --check` validés. |

Les tentatives initiales conservent les échecs détectés et leurs temporaires ; les
preuves de clôture reposent sur les trois `*-launcher-final.log`. Les commandes
finales ont été exécutées depuis les ports avec `TMPDIR` dans le dossier
`opencode` approuvé. Les anciens résultats M10/M11 gardent leurs périmètres datés.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m12/`,
notamment `before.json`, `base/`, `aff-first.log`, `aff-second.log`, `aff/`,
`aff-replays.log`, `aff-launcher-final.log`, `promise-launcher-final.log`,
`bridge-launcher-final.log`, `ffi-ports.log`, `test-tools-final.log`,
`selection-checks.json`, `artifact-checks.json` et `final-source-hashes.json`.

**Conclusion : M12 validé, +20 points ; plan v2 à 20/100, 1 lot sur 5.
Prochain lot : M13 — CLI explicite et sorties Java maîtrisées.**

## Validation M13

**3 octobre 2026 — CLI explicite et sorties Java maîtrisées.**

### Références et périmètre

Référence initiale Javapurs : `29f3205c056df32e8de55a43f11e9c6a952f3d2d`, avec les
changements M11/M12 déjà présents. `before.json` conserve **4 230 empreintes** des
fichiers présents suivis ; `base/` conserve le pilote précédent. Une référence
Java a été enregistrée avec ce pilote avant modification. Au relevé final, le
commit intermédiaire `56dd969f0ad3e97b81aa8992415afe58fe890236` intègre le nettoyage
et l'implémentation M13 ; les validations incluent les correctifs de fixture et
la documentation de clôture.

Références relevées pour le build final :

| Composant | Révision |
| --- | --- |
| PBO Java, checkout propre | `c9386b4d572503bb7b6d1ce9547ec30dcded2920` |
| Fork PureScript, checkout propre | `b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16` |
| Aff | `80a861b1c096eba941f4b6186a74f4ccacb47765` |
| Ref | `228bb557d2ade1f978146361dc40e3d775d53fd3` |
| Promise | `ed5900a79a05da1c83c9ecb57f5a708e29aba466` |
| Promise/Aff | `06ae9a304e3434a303fd9f18d877055b856d4672` |

Node **24.8.0**, Spago **1.0.3**, binaire `~/.local/bin/purs` annoncé
`0.15.16 [development build; commit: 3c8fcfd7a3d440bba487fe9fe059284cffc6e908 DIRTY]` ;
`javac` et JVM Homebrew **26.0.2**, compilation Java en **`--release 17`**.
`references.json` distingue les binaires effectivement exécutés et les checkouts.

### Changements livrés

- `Config` expose `Either String Command`, aide, valeurs séparées/avec `=`, options
  uniques et erreurs précoces. `Main` possède la frontière des codes 0/2/1.
  `--input`/`--output` désignent le TAST ; `--java-output` la destination Java.
  L'espion d'intégration confirme que Spago ajoute un chemin TAST **absolu** à
  ses `backend.args`, sans argument `build`.
- `Driver.validateMain` distingue application et bibliothèque (`--no-main`) et
  refuse avant préparation des sorties un module absent, sans main, non exporté
  ou simplement réexporté. Validation des chemins disjoints, y compris symlinks.
- `Output.purs`/`Output.js` possèdent staging, manifeste SHA-256, verrou PID,
  publication et récupération ; `Emit` conserve l'assemblage du texte Java.
  Retrait limité à l'inventaire, préservation des fichiers étrangers/modifiés,
  adoption des anciens fichiers identiques, et diagnostic du launcher non géré.
- Le launcher est masqué pendant le remplacement des modules, même quand ses
  octets ne changent pas ; il est publié/restauré après ses modules. Le journal
  permet le retour à la génération précédente sur erreur/interruption ; un état
  `committed` conserve la nouvelle génération. Une reprise en conflit conserve
  les fichiers et ses preuves. La phase `publish Java` rend cette frontière visible.
- README, carte du compilateur, guides rendu/FFI/entretien, matrice et recette du
  pilote documentent la CLI, les codes, la migration et le cycle de vie.

### Vérifications ciblées

Les commandes suivantes ont été exécutées depuis le dépôt du compilateur ;
`BASELINE` désigne le dossier local `javapurs-m13/driver-baseline`.

| Contrôle | Résultat |
| --- | --- |
| `node test/driver.mjs --record "$BASELINE"` avec l'ancien pilote | Référence enregistrée avec succès : 13 anciennes variantes, entrée vide et six erreurs d'I/O attendues. |
| `./bin/build` | **0 erreur, 0 avertissement** ; nouveau module `Output` et FFI reconstruits. |
| `node test/driver.mjs --compare "$BASELINE"` | **11 variantes**, aide, **25 échecs attendus**, cycle de vie, chemins avec espaces et **deux builds Spago réels** réussis ; **86 fichiers Java identiques** aux références. |
| `node test/driver.mjs` | Même couverture dans un workspace neuf et supprimé au succès : **13 compilations Java**, dont la bibliothèque, et **12 exécutions JVM**. |
| `node --test test/output-files.mjs` | **9/9 groupes** ; six points de panne de renommage, trois étapes de `SIGKILL`, propriété/adoption, conflits et récupération vérifiés. |
| `node test/ffi-ports.mjs` | **17 assertions × 2 modes**, records typés puis Maps dans la même destination Java, pont Promise/Aff et attente de la fibre réussis. |
| Contrôle des sources/artefacts | **43 sources du compilateur** hors orchestration identiques aux empreintes initiales ; sources runtime des quatre ports identiques à leurs références pré-M13 ; FFI construite `Output` identique à sa source. |
| Documentation, syntaxe et diff | Liens/ancres, exemples Bash, **25 suites**, **12 options**, score **45/100**, syntaxe Node et `git diff --check` validés. |

Les neuf variantes CLI conservées sont comparées sur les mêmes TAST/FFI/options.
Les autres comparaisons vérifient les équivalences `--main=Chosen`/`--main Chosen`,
bibliothèque explicite/ancien main absent, et entrée vide avec `--no-main`.
Les anciens arguments permissifs deviennent les sondes négatives du nouveau
contrat. Les différences d'artefacts attendues sont le manifeste et le staging ;
aucun changement de texte Java n'a été constaté dans ces références.

La reconstruction a aussi actualisé les modules construits PBO `Builder` et
`Cache` depuis le checkout courant : inlining privé du builder parallèle et
instrumentation/portée du cache `.purmeta`. Le pilote utilise le builder
séquentiel. Ces sources PBO n'ont pas été éditées pour M13 ; les comparaisons et
l'intégration ci-dessus portent sur le build effectivement obtenu.

### Nettoyage demandé pendant le lot

Retrait de **3 641 fichiers / 80 859 191 octets** : ancien build REPL, journaux,
métadonnées Finder et ancien état généré de `tests/runner`. L'archive a été relue
et vérifiée par tailles/SHA-256 avant suppression ; les **907 retraits de fichiers
suivis** depuis le relevé initial sont tous couverts par cet inventaire. Le runner
contenait une copie exacte de la fixture `DerivingTraversable.purs` du fork.
La [fiche d'entretien](maintenance.md#nettoyage-demandé-pendant-m13) donne les
chemins de l'archive et les règles d'exclusion ajoutées.

### Preuves et limites

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m13/`,
notamment `before.json`, `base/`, `driver-baseline/`, `driver-before.log`,
`driver-after.log`, `driver-final.log`, `driver-isolated.log`, `build-final.log`,
`output-files-final.log`, `ffi-ports.log`, `references.json`, `artifact-checks.json`,
`final-source-hashes.json` et `cleanup/`.

La reprise teste la mort du processus et les erreurs filesystem, avec publication
fichier par fichier ; la durabilité après coupure machine n'est pas garantie par
`fsync`. Le contrat d'entrypoint vérifie présence/localité/export, sans nouvelle
preuve de type pour l'ABI. Le chargement tolérant de PBO et le cycle des caches
`.purmeta` restent décrits dans le guide. La compatibilité de génération est
étayée par les entrées nommées ci-dessus ; les références b8x/BigFunction gardent
leurs validations historiques. Le périmètre est resté ciblé conformément au plan.

**Conclusion : M13 validé, +25 points ; plan v2 à 45/100, 2 lots sur 5.
Prochain lot : M14 — FFI sélectionnée et manquante observable.**

## Validation M14

**5 octobre 2026 — FFI sélectionnée et manquante observable.**

### Références et périmètre

Javapurs au départ : **`df12d7f0138b967a09ec28b02bd6f5e6adb59b05`**, checkout propre.
`before.json` conserve **3 341 empreintes**, les références voisines et leurs états ;
`base/` conserve les sources concernées. Le commit intermédiaire
`23e56373989146cfb4a0db1aa6532e660ca80548` a intégré l'implémentation pendant le lot ;
les validations de clôture incluent le champ final `retained` et la documentation.

| Dépôt voisin | Révision relevée, sources inchangées pendant M14 |
| --- | --- |
| PBO Java | `8f97f1dc83bca51cb697cb01b66868d3abb61938` |
| Fork PureScript | `b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16` |
| Aff | `80a861b1c096eba941f4b6186a74f4ccacb47765` |
| Refs | `228bb557d2ade1f978146361dc40e3d775d53fd3` |
| Promise | `ed5900a79a05da1c83c9ecb57f5a708e29aba466` |
| Promise/Aff | `06ae9a304e3434a303fd9f18d877055b856d4672` |

Node **24.8.0**, Spago **1.0.3**, binaire `~/.local/bin/purs` annoncé
`0.15.16 [development build; commit: 3c8fcfd7a3d440bba487fe9fe059284cffc6e908 DIRTY]` ;
compilation et exécution avec OpenJDK Homebrew **26.0.2**, cible **Java 17** pour
les fixtures JVM. `references.json` enregistre chemins des binaires et checkouts.

### Livrables et contrat

- `Ffi.describeForeign` et son FFI Node décrivent le résultat réel de PBO, sans
  modifier sa priorité ni refaire la recherche. Module source, candidat adjacent,
  Java retenu, chemins absolus/réels et origine d'emplacement, empreinte du texte,
  états fourni/vide/absent/sans besoin, noms PureScript/Java et présence dans
  l'inventaire foreign optimisé sont explicités. `verification: "not-checked"`
  distingue sélection et couverture.
- `Driver` enregistre les descriptions dans `Output`. Le champ `ffi` version 1
  du manifeste version 1 est publié et restauré avec les sources Java ; il
  remplace l'inventaire précédent à chaque succès, y compris pour une bibliothèque
  vide. Les diagnostics stderr de chaque module et le chemin du relevé final
  permettent de retrouver cette sélection.
- Pour une FFI absente/vide, les champs de bindings utilisent `__MissingFFI`,
  implémentant `Function` et `Supplier`. Appels curryfiés, forçages d'effets et
  méthodes varargs identifient le **nom PureScript complet** du binding dans
  `UnsupportedOperationException`. Le sentinel historique `FFI_STUB` reste présent.
- Un fragment non vide reste inséré tel quel. Le cas partiel et le fichier
  d'espaces sont volontairement `provided`/`not-checked` : les fixtures montrent
  que le binding omis est rejeté par `javac` lorsqu'un consommateur le référence.
- La [table de couverture](ffi-runtime.md#couverture-exécutée-et-dépendances-des-quatre-ports)
  nomme les groupes et assertions des quatre ports, leurs dépendances et le
  parcours transitif `Promise.Aff` → `Promise.Rejection`/`Foreign` des rejets.

### Vérifications ciblées

Commandes depuis le dépôt du compilateur ; `BASELINE` correspond au dossier local
`javapurs-m14/driver-baseline` créé avant modification.

| Contrôle | Résultat |
| --- | --- |
| `node test/driver.mjs --record "$BASELINE"`, avant modification | Référence M13 enregistrée : 11 variantes, 25 échecs attendus, deux builds Spago, TAST/FFI figés. |
| `./bin/build` | Build final **sans erreur ni avertissement**. La première reconstruction des sources PBO courantes signalait trois warnings de code/imports inutilisés dans `Semantics`, consignés dans `build-first.log`. |
| `node test/driver.mjs` | **11 variantes**, aide, **25 échecs attendus**, cycle des sorties, chemins avec espaces et **deux builds Spago** réussis. |
| `node test/ffi-diagnostics.mjs` | **8 rapports de modules**, **3 choix de fragments** confirmés sur JVM, **8 erreurs de stub** nommant le binding, **2 erreurs `javac`** pour membres omis et **1 erreur de lecture** attendues ; ancien rapport conservé. |
| `node test/ffi-ports.mjs` | **17 assertions × 2 modes** ; rapport identique entre modes, fragments Aff/Ref/Promise/Foreign locaux identifiés et pont réel exécuté. Troisième build Spago avec `Foreign` du registre : absence de Java et source `.spago/p/foreign-…` correctement relevées. |
| `node --test test/output-files.mjs` | **9/9 groupes**, avec métadonnées FFI différentes entre générations : les six pannes de renommage et les trois étapes de `SIGKILL` conservent/restaurent le relevé avec les sources correspondantes. |
| Comparaison ciblée `compare-java.mjs` | Sur les **86 fichiers** des variantes figées et de l'entrée vide : **64 identiques**, **22 changements limités aux stubs** `Missing`/`Empty`, mêmes inventaires et empreintes TAST/FFI. |
| Empreintes | **45 sources du compilateur** hors fichiers modifiés identiques au relevé initial ; sources des voisins/PBO inchangées ; FFI construites `Ffi`/`Output` identiques aux sources. |
| Documentation et syntaxe | Matrice de **26 suites**, **12 options CLI**, score **65/100**, liens/ancres et exemples shell, syntaxe Node et `git diff --check` validés. |

La comparaison conserve exactement les options, TAST et fragments de départ.
Pour les seuls modules `Missing`/`Empty`, elle retire le helper `__MissingFFI` et
remplace les deux formes de champ connues afin de vérifier que le reste du Java
est identique ; les huit assertions JVM vérifient le comportement de ces nouvelles
formes. Les fragments fournis, helpers communs, records, chunks et launchers des
références gardent leurs octets. Le manifeste ajoute les métadonnées `ffi`.

Le build a aussi actualisé sept fichiers JS construits de PBO depuis sa référence
courante (`Builder`, `CoreFn`, `Directives`, `FreeVars`, `Monomorphize`,
`NativeMaps`/FFI). Ces actualisations sont inventoriées dans `artifact-checks.json` ;
les comparaisons et l'intégration portent sur ce build effectif. Les passes Java
et les runtimes des ports conservent leurs sources.

### Preuves et limites

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m14/`,
notamment `before.json`, `base/`, `driver-baseline/`, `driver-before.log`,
`driver-after.log`, `build-first.log`, `build-final.log`, `ffi-diagnostics-final.log`,
`ffi-ports-final.log`, `output-files.log`, `compare-java.mjs`, `comparison.log`,
`java-after/`, `java-comparison.json`, `references.json`, `artifact-checks.json`
et `final-source-hashes.json`.

Le relevé décrit les modules émis et les choix du résolveur ; il ne prouve pas
l'atteignabilité/exécution des imports ni la couverture des fragments fournis.
Le diagnostic précis des stubs concerne les frontières d'appel/forçage : une
valeur scalaire absente peut être rejetée à son cast/unboxing. Les labels `origin`
qualifient les chemins, pas un graphe de packages reconstruit. Les preuves directes
des runtimes M10 et les suites complètes de ports M12 restent datées ; M14 valide
la frontière FFI et l'intégration nommée, conformément au périmètre ciblé du plan.

**Conclusion : M14 validé, +20 points ; plan v2 à 65/100, 3 lots sur 5.
Prochain lot : M15 — installation source reproductible.**

## Validation M15

**5 octobre 2026 — installation source reproductible.**

### Sources et outils effectivement employés

Le checkout Javapurs part de **`23e56373989146cfb4a0db1aa6532e660ca80548`**,
avec les changements de clôture M14 encore présents, dont `retained` dans le relevé
FFI. L'export inclut cet arbre courant et les outils M15 ; `backend.dirty` et les
empreintes par fichier distinguent ce snapshot de son commit de base.

Les sept sources ont été fetchées depuis GitHub par SHA, sans utiliser les
checkouts voisins du poste de développement :

| Dépôt | Révision fixée par le manifeste source |
| --- | --- |
| Fork PureScript | `b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16` |
| PBO Java | `8f97f1dc83bca51cb697cb01b66868d3abb61938` |
| `foreign-object` | `8296fd5d84f6a4e84bd4e3229a5beb214d9922f3` |
| `prelude` | `67e8590b0478e82b835e7f4c5eac848d283674b0` |
| `effect` | `e244794fc4beeda5d3283199fe90813c38d9695a` |
| `console` | `a1fa3d4dfe882a70067f56bf41ea1c4e6e63b834` |
| `refs` | `228bb557d2ade1f978146361dc40e3d775d53fd3` |

Outils : Node **24.8.0**, Spago **1.0.3**, Stack **3.11.1**, Git **2.50.1**,
Bash **3.2.57**, GHC **9.8.4** choisi par Stack, OpenJDK Homebrew **26.0.2**
pour `javac`, `java` et `jar`. Le `purs` reconstruit annonce exactement :

```text
0.15.16 [development build; commit: b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16]
```

Il provient du nouveau `workspace/bin/purs`, avec chemin et SHA-256 consignés,
et non du `~/.local/bin/purs` historique étiqueté `3c8fcfd7… DIRTY`.
Pour le rejeu final, son SHA-256 est
`b0cbba14f64305d70ddfa111a8d9b8907df88cdb4d57159a4805574c5637b549`.
La sonde du nouveau binaire produit `builtWith: "0.15.16"`, **1 `dataDecls`,
1 `classDecls`, 15 entrées `typeTable`**. Le build local depuis un autre dossier
a aussi vérifié cette capacité sur le binaire historique, en affichant son
étiquette distincte.

### Livrables

- [Manifeste source](../tools/source-lock.json),
  [installateur](../tools/install-source.mjs) et inventaire `installation.json` :
  références, sources exportées, binaires/versions, empreinte du `purs`, commandes,
  état final et résultats applicatifs. Fork et backend ont des builds de projet
  neufs ; aucun `output/` ou `.spago/` du checkout du backend n'est exporté.
- `bin/build` → [build.mjs](../tools/build.mjs) : localisation du checkout,
  prérequis et sonde du format avant Spago. Les launchers nomment Node absent ou
  un build manquant/incomplet avec le chemin de reconstruction.
- [Hello](../examples/hello/src/Main.purs) reproduit les trois fichiers du README ;
  [Refs](../examples/refs/src/Main.purs) exerce lecture/modification et affichage
  avec ports locaux et FFI transitive. [source-smoke.mjs](../tools/source-smoke.mjs)
  construit/exécute les classes, empaquette les JAR et vérifie leur autonomie.
- [Guide d'installation](installation.md), README, carte du compilateur, matrice,
  maintenance et plan de suivi actualisés.

### Vérifications ciblées

Les preuves résident sous
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m15/`.
Les destinations contiennent volontairement une espace. La première installation
complète (`source workspace`) a réussi : **182 modules de bibliothèque Haskell**
et l'exécutable `purs` reconstruits, puis **459 modules PureScript** incluant
Javapurs/PBO et leurs dépendances. Les sept checkouts fetchés sont propres, et le
lockfile du backend conserve son empreinte. Le build neuf affiche les trois
avertissements PBO préexistants de `Semantics` déjà relevés en M14, sans erreur.
Le **second parcours complet** (`final workspace`), avec les scripts finalisés,
reconstruit les mêmes composants et réussit les contrôles supplémentaires :
lockfile Stack en lecture stricte, lockfile Spago inchangé, chemin réel des trois
fragments FFI et bytecode du launcher de version majeure **61**.

| Contrôle | Résultat |
| --- | --- |
| `node tools/install-source.mjs "$PROOF/source workspace"` | Installation complète réussie depuis les sources fetchées et le snapshot du backend. |
| `node tools/install-source.mjs "$PROOF/final workspace"` | **Second succès complet**, **78 fichiers exportés**, sept révisions fetchées propres ; inventaire final avec capacités TAST, commandes et deux applications. Les **77 sources/configurations hors README** correspondent encore aux fichiers courants après clôture documentaire. |
| `bin/build` appelé depuis `$PROOF` | Sonde TAST puis build du bon checkout ; **0 erreur, 0 avertissement** sur cette reconstruction incrémentale. |
| `node --test test/source-install.mjs` | **6/6 groupes, 29 échecs attendus** : bon répertoire, deux packages/Node/Spago/purs absents, neuf métadonnées TAST manquantes/vides/mal formées, launcher incomplet, destination existante, arguments et huit cas de prérequis/version d'installation. |
| `node test/driver.mjs --compare "$PROOF/driver-compare"` | **11 variantes**, **25 échecs attendus**, deux builds Spago et cycle des sorties ; **86 fichiers Java identiques** à la clôture M14 sur ses entrées figées. |
| `node "$PROOF/compare-installed.mjs"` | Même comparaison avec le **backend reconstruit par le nouveau fork** : **86/86 fichiers Java identiques**, inventaires et empreintes TAST/FFI vérifiés. |
| Launcher installé `--help` depuis `htdocs/` | Aide complète et code 0 ; wrapper du workspace et import du build validés hors du dossier du backend. |
| Empreintes et sources voisines | **50 fichiers `src/` identiques** à la clôture M14 ; sept checkouts voisins d'origine toujours propres et aux références annoncées. |

`driver-compare/expected` reprend `javapurs-m14/java-after` ; TAST et fragments
viennent du baseline M14 avec vérification SHA-256. Le smoke Hello produit
**114 fichiers Java**, Refs **118**. Les deux sorties attendues sont contrôlées en
classes puis en JAR depuis des dossiers ne contenant qu'`app.jar`, avec le dossier
JDK seul sur `PATH` et aucun classpath externe.

La revue finale vérifie aussi l'identité des trois fichiers Hello avec les blocs
du README, **six syntaxes Node**, **deux launchers Bash**, les liens/ancres et
exemples shell, les **27 suites**, **12 options CLI**, le score du plan et
`git diff --check`.

Preuves : `install.log`, `install-final.log`, les deux `installation.json`,
`logs/{purs-build,backend-build,applications}.log`, `apps/smoke.json`, les logs et
JAR de chaque exemple, `build-local.log`, `source-tests.log`, `driver.log`,
`compare-installed.mjs`, `compare-installed.log`, `installed-java-comparison.json`,
`source-compatibility.json` et `checks.json`. Les dossiers de preuve sont locaux ;
les références et la recette rejouable sont versionnées dans le dépôt.

### Limites de la preuve

La reconstruction est isolée par répertoire, sur **macOS arm64** avec caches
utilisateur Stack/Spago disponibles. Les dépendances Haskell du snapshot peuvent
venir du cache ; le fork lui-même et les 459 modules du backend sont reconstruits.
La reproductibilité porte sur les références, le parcours et les résultats,
pas sur une image système hermétique ou l'identité des timestamps des JAR.

La sonde de build contrôle le `purs` sélectionné, pas des TAST applicatifs anciens.
Les cas incompatibles de la suite Node utilisent des commandes contrôlées annonçant
la même version et produisant des métadonnées invalides ; le parcours positif
utilise réellement le fork recompilé. L'exemple Refs prouve les opérations
exécutées et les fragments sélectionnés, sans étendre la couverture à tous les
bindings des ports. Les classes ciblent **Java 17**, exécutées ici sur **JVM 26.0.2**.

**Conclusion : M15 validé, +20 points ; plan v2 à 85/100, 4 lots sur 5.
Prochain lot : M16 — compatibilité JDK mesurée et cible cohérente.**

## Validation M16

**5 octobre 2026 — compatibilité JDK mesurée et cible cohérente ; clôture du plan v2.**

### Références et outils

Le dépôt Javapurs part de **`23e56373989146cfb4a0db1aa6532e660ca80548`**, avec
les changements M14/M15 encore présents. Le dossier de preuves `javapurs-m16/base/`
et `before.json` conservent **104 fichiers**, leurs SHA-256 et l'état Git initial.
Le backend construit est celui validé en M15 ; les **50 fichiers de génération
`src/`** gardent leurs empreintes. Les modifications portent sur les outils Node,
leurs consommateurs de flags Java et la documentation.

Node **24.8.0**, Spago **1.0.3**, `purs` **0.15.16** reconstruit en M15 depuis
**`b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16`**, sans marqueur `DIRTY` ; PBO Java
**`8f97f1dc83bca51cb697cb01b66868d3abb61938`**. La matrice prend ce `purs` via
le `bin/` du workspace final M15. Les chemins effectifs et versions complètes
figurent dans `matrix/matrix.json`.
Les quatre ports Aff/Refs/Promise/Promise-Aff conservent les révisions relevées en
[M14](testing.md#validation-m14) ; `references-final.json` confirme ces SHA et leurs
checkouts propres à la clôture M16.

| Outil Java | Distribution et référence |
| --- | --- |
| JDK 17 | **Eclipse Temurin 17.0.20.1+1**, macOS aarch64 HotSpot ; `javac 17.0.20.1`, JVM `17.0.20.1`, build `17.0.20.1+1`. |
| JDK récent | **OpenJDK Homebrew 26.0.2**, macOS arm64 ; `javac 26.0.2`, JVM/build `26.0.2`. |

Le JDK 17 a été téléchargé et extrait uniquement dans le dossier de preuves,
depuis la [release Temurin épinglée](https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.20.1%2B1).
Archive `OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.20.1_1.tar.gz`,
**185 851 019 octets**, SHA-256 vérifié avant extraction :
`196d13ba5f10414bef7f6a05a9b3f00edacb18ebacef2b99485db9e2ee18f0e8`.
`jdk17.json` conserve URL exacte, empreinte, chemin Home et version exécutée.

### Contrat livré

- [java-tools.mjs](../tools/java-tools.mjs) possède le défaut **17**, les arguments
  `--release`, les versions et la distinction paire de build / JVM d'exécution.
  `JAVAPURS_JAVA_RELEASE` est strict ; `JAVAPURS_JAVA_RUNTIME` est le seul override
  autorisant une JVM d'un autre dossier. Les outils sont résolus en chemins réels.
- Le résolveur rejette outils absents, version illisible, cible mal formée ou
  supérieure au compilateur/runtime. `javaCompileArgs` refuse les flags de cible
  concurrents avant la préparation destructive d'une fixture.
- Toutes les invocations `javac` des suites Node reprennent les mêmes arguments,
  de même que `fixture-runner`, le runner des trois ports asynchrones et le smoke
  de l'installation source. BigFunction et son harness supplémentaire partagent
  enfin la même cible ; les flags de heap restent indépendants.
- [check-jdk.mjs](../tools/check-jdk.mjs) exécute une sélection fixe de **six suites**
  dans **trois configurations**. Il garde un rapport global, les logs par suite,
  une sonde de bytecode et une sonde de version JVM ; une destination existante
  est refusée. La matrice impose cible 17 et relève séparément ses trois dimensions.

### Commandes et résultats

Depuis `javapurs/javapurs`, avec `JDK17_HOME` égal au Home extrait et
`JDK_RECENT_HOME` égal à `/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home` :

```bash
export PATH="$M15_WORKSPACE/bin:$PATH"
node tools/check-jdk.mjs --jdk17 "$JDK17_HOME" \
  --recent-jdk "$JDK_RECENT_HOME" --output "$PROOF/matrix"
node --test test/test-tools.mjs test/source-install.mjs
```

| JDK de compilation | Cible | JVM d'exécution | Résultat |
| --- | --- | --- | --- |
| Temurin 17.0.20.1+1 | 17, classe majeure 61 | Temurin 17.0.20.1+1 | **6/6 suites** |
| Homebrew 26.0.2 | 17, classe majeure 61 | Homebrew 26.0.2 | **6/6 suites** |
| Homebrew 26.0.2 | 17, classe majeure 61 | Temurin 17.0.20.1+1 | **6/6 suites** |

Dans **chacune** des trois lignes :

| Suite | Résultat ciblé |
| --- | --- |
| `driver.mjs` | **11 variantes**, aide, **25 échecs attendus**, cycle des sorties et **deux invocations Spago** réelles. |
| `representations.mjs` | **43 assertions JVM × 8 modes = 344** : records typés/Maps, Int/générique, appels directs on/off et ABI FFI. |
| `chunk.mjs` | **15 fixtures**, dont captures, tailles/profondeurs et frontières d'extraction. |
| `big-function.mjs` | Entrypoint réel réussi et **155 contrôles de branches**, dont 26 patterns non vides réussis. |
| `ffi-runtimes.mjs` | **36 contrôles de protocoles** : Refs 4, Promise 14, Aff 18. |
| `ffi-ports.mjs` | **17 assertions × 2 modes**, pont Promise/Aff réel attendu, fragments locaux et sélection `foreign` du registre diagnostiqués. |

Les suites créent de nouvelles classes dans leurs workspaces. La ligne croisée
exécute réellement sur JVM 17 les classes que `javac 26.0.2 --release 17` vient
de produire ; elle ne déduit pas cette compatibilité du seul flag de compilation.

Contrôles complémentaires des consommateurs modifiés :

| Commande/configuration | Résultat |
| --- | --- |
| `node --test test/test-tools.mjs test/source-install.mjs` | **19/19 groupes** : 13 d'outillage, 6 d'installation. Nouveaux cas : neuf valeurs de cible invalides, compilateur/runtime trop anciens, runtime absent/version illisible, override croisé propagé et sept conflits de flags refusés avant nettoyage. |
| `../javapurs-js-promise-aff/bin/test` avec `JAVA_HOME="$JDK17_HOME"` | **7 assertions de suite + 4 sondes négatives**, via le vrai launcher et le runner partagé. |
| `node test/ffi-diagnostics.mjs` avec JDK 17 | **8 rapports, 3 sélections, 8 contrôles JVM de stubs**, deux échecs `javac` et un échec de lecture attendus. |
| `node tools/source-smoke.mjs "$M15_WORKSPACE" "$PROOF/source-smoke-cross"` avec build JDK 26 et `JAVAPURS_JAVA_RUNTIME="$JDK17_HOME/bin/java"` | Hello et Refs réussis en classes et **deux JAR autonomes sur JVM 17**, bytecode majeur 61 et fragments locaux vérifiés. |

Les environnements complémentaires fixent `JAVAPURS_JAVA_RELEASE=17` et retirent
les éventuels overrides `JAVAC`/`JAVA` avant de choisir `JAVA_HOME`. Le smoke croisé
utilise le backend et les ports épinglés installés en M15, avec le runner courant.

### Preuves, revue et limites

Preuves locales sous
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m16/` :
`before.json`, `base/`, `jdk17.json`, archive/JDK extrait, `matrix.log`,
`matrix/matrix.json`, les dix-huit logs de suites et sondes JVM/bytecode,
`tool-tests.log`, `port-promise-aff-jdk17.log`, `ffi-diagnostics-jdk17.log`,
`source-smoke-cross.log`, `source-smoke-cross/smoke.json`, `references-final.json`
et `checks.json`.

La revue confirme **18 migrations de suites strictement mécaniques**, **29
vérifications de syntaxe Node**, les **50 empreintes de sources de génération**,
les liens/ancres et exemples shell, la matrice/options/score et `git diff --check`.
La matrice documente **ces deux distributions sur macOS arm64**, avec **cible 17**
et ces six suites. Les autres versions/vendors/OS, les autres cibles et l'ensemble
des API des ports ne sont pas extrapolés. Les anciennes validations restent
datées ; les anciens runners purement shell conservent leurs réglages propres.

**Conclusion : M16 validé, +15 points ; plan v2 terminé à 100/100, 5 lots sur 5.**

## Validation M17

**5 octobre 2026 — chargement TAST strict avant publication ; lot complémentaire.**

### Constat et références

Javapurs part de **`23e56373989146cfb4a0db1aa6532e660ca80548`**, avec les
changements M14–M16 présents. `before.json` et `base/` conservent **66 fichiers**
et leurs empreintes initiales. Sur la fixture figée du pilote, un
`Missing/corefn.json` remplacé par `{`, puis un fichier supprimé, donnaient tous
deux **code 0** en bibliothèque : `__M$Missing.java` était retiré. La suppression
des trois tableaux enrichis donnait aussi code 0. `reproduction.json` et les
logs `before-*` consignent ces comportements du lecteur générique PBO.

Références PBO **`8f97f1dc83bca51cb697cb01b66868d3abb61938`**, frontend
**`b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16`** ; mêmes ports que M16.
Node **24.8.0**, Spago **1.0.3**, `purs` reconstruit en M15 sans `DIRTY`,
SHA-256 **`b0cbba14f64305d70ddfa111a8d9b8907df88cdb4d57159a4805574c5637b549`**.
Les runs Java utilisent Homebrew **26.0.2**, compilation **`--release 17`** et
exécution sur JVM **26.0.2**, sur macOS arm64.

### Livrables

- [Input.purs](../src/Javapurs/Input.purs) possède lecture stricte, parsing JSON
  unique, exigence des trois tableaux, décodage PBO, détection des doublons et
  contrôle des dépendances avant le tri PBO. [Input.js](../src/Javapurs/Input.js)
  reprend le réglage borné `GOPURS_JOBS`. `Driver` appelle cette frontière dans
  `load TAST + sort`, avant `validateMain` et `Output.withOutput`.
- L'intégration Spago a exposé les dossiers `Prim`/`Prim.*` contenant seulement
  `docs.json` : ils sont admis sans CoreFn. Un CoreFn présent dans ces dossiers
  est contrôlé. Les autres sous-dossiers exigent un fichier lisible.
- `spago.yaml` déclare `argonaut-codecs` ; le lockfile régénéré enregistre aussi
  les dépendances actuelles du package PBO local épinglé. Leurs versions ne
  changent pas. Les sorties construites incluent `Javapurs.Input` et le pilote.
- [test/input.mjs](../test/input.mjs), contrat d'entrée, README, matrice et suivi
  sont livrés. Le vérificateur documentaire exige aussi une preuve pour chaque
  lot complémentaire coché, en conservant le score du plan pondéré.

### Vérifications ciblées

`PROOF` désigne le dossier local `javapurs-m17` ci-dessous. Les commandes utilisent
`TMPDIR` sous `opencode` et le `bin/` du workspace final M15 en tête du `PATH`.

| Commande/contrôle | Résultat |
| --- | --- |
| `./bin/build`, checkout courant | Sonde TAST et reconstruction du lecteur/pilote ; **0 erreur, 0 avertissement**. |
| `./bin/build`, export sous `clean workspace/javapurs/javapurs` | **460 modules reconstruits**, sans `output/` ni `.spago/` initial. Les packages locaux sont exportés aux références épinglées ; le binaire `purs` M15 est réutilisé. **0 erreur**, trois avertissements PBO `Semantics` préexistants ; lockfile conservé octet pour octet. |
| `node test/input.mjs`, depuis cet export reconstruit | **28 entrées invalides × 2 réglages de lecture × 2 modes de destination = 112 refus attendus**. Code 1, diagnostic, phase de chargement échouée, Java/manifeste/caches préservés et destination neuve absente. Le cas permissions a bien été exécuté. |
| Cas valides de la même suite | Modules/déclarations vides et non vides, docs Prim, imports primitifs, fichiers ordinaires, symlinks ; sources et manifeste identiques avec lectures à **1/2/64**, replis des réglages invalides et après restauration des entrées. |
| `node test/driver.mjs --compare "$PROOF/driver-compare"` | **11 variantes**, aide, **25 échecs attendus**, cycle des sorties et deux invocations Spago réelles ; **86 fichiers Java identiques** sur les TAST/FFI figés issus du baseline M14/M15. |
| `node test/ffi-ports.mjs` | **17 assertions × 2 modes**, records typés puis Maps ; pont Promise/Aff attendu, fragments locaux et sélection `foreign` du registre diagnostiqués. |
| Empreintes de sources | **49 des 50 fichiers `src/` initiaux identiques** ; seul `Driver.purs` change pour appeler les deux nouveaux fichiers `Input`. Les 52 sources courantes correspondent à l'export reconstruit. |

La revue finale contrôle la syntaxe des entrées JavaScript ajoutées/modifiées,
liens/ancres, exemples Bash, matrice des **28 suites**, **12 options CLI**, score
du plan et présence de la preuve M17, puis `git diff --check`.

### Preuves et portée

Preuves locales sous
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m17/` :
`before.json`, `base/`, `reproduce.mjs`, `reproduction.json`, `before-*.log`,
`build-final.log`, `clean-export.json`, `clean-build.log`, `clean workspace/`,
`input-final.log`, `driver.log`, `driver-compare/`, `ffi-ports.log`,
`source-checks.json`, `references-final.json` et `checks.json`.

Les premiers essais ont identifié l'exemption des docs Prim et corrigé la
restauration des symlinks dans la suite ; leurs logs restent distincts des
preuves finales. Les suites couvrent le lecteur réel et la génération sur ces
entrées ciblées. Le contrat des trois tableaux reste minimal : pas de nouveau
versionnement de schéma, ni de preuve exhaustive sur les annotations facultatives
de PBO. Un module entièrement retiré et non importé correspond toujours à un
retrait légitime lors d'une génération réussie. Les validations Java plus larges
et la matrice JDK conservent leurs dates et périmètres précédents.

**Conclusion : M17 validé ; complément clôturé. Plans v1 et v2 toujours à 100/100.**

## Validation M18

**5 octobre 2026 — entrée JVM invalide sans faux succès ; lot complémentaire.**

### Constat, références et correction

Sur trois petits modules réels compilés avec le fork, le backend puis `javac`,
`main = 42`, une FFI `main = null` et une FFI `main = new Object()` donnaient tous
**code JVM 0, sans stdout ni stderr**. Le template n'avait pas de branche pour
les valeurs qui n'implémentent aucune des deux ABI du launcher. `reproduce.mjs`,
`reproduction.json` et les logs `before-*` conservent le constat.

Référence Javapurs **`23e56373989146cfb4a0db1aa6532e660ca80548`**, changements
M14–M17 présents ; **67 fichiers initiaux** sauvegardés avec leurs empreintes.
PBO **`8f97f1dc83bca51cb697cb01b66868d3abb61938`** et frontend
**`b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16`**, checkouts propres.
Node **24.8.0**, Spago **1.0.3** et binaire `purs` reconstruit en M15,
SHA-256 **`b0cbba14f64305d70ddfa111a8d9b8907df88cdb4d57159a4805574c5637b549`**.

Le changement de production est limité à
[Runtime.mainRunSource](../src/Javapurs/Runtime.purs) : une branche `else` lève
`IllegalStateException` avec `ClasseJava.main` et la classe effective, ou `null`.
Le diagnostic n'appelle pas `toString()` sur l'objet FFI. Le chemin `Supplier`
reste prioritaire ; `Function` reçoit `null`. La signature du template reste
`String -> String`. Le [contrat du launcher](compiler.md#6-compilation-et-exécution-java),
la nouvelle [suite](../test/entrypoint.mjs), le README, la matrice et le TODO sont
mis à jour ensemble.

### Vérifications ciblées

Les commandes sont lancées depuis le dépôt, avec le `purs` M15 sur `PATH` et
`TMPDIR` dans le dossier `opencode`. La compilation Java et l'outil `jar` viennent
du JDK Homebrew **26.0.2**, avec **`--release 17`**, sur macOS arm64.

| Configuration de `node test/entrypoint.mjs` | Résultat |
| --- | --- |
| JVM Homebrew **26.0.2** | **10 variantes × classes/JAR**, 6 succès et 14 échecs JVM attendus. |
| Même JDK de build, `JAVAPURS_JAVA_RUNTIME` vers Temurin **17.0.20.1+1** | **10 variantes × classes/JAR**, mêmes 6 succès et 14 échecs attendus, exécutés réellement sur JVM 17. |

Pour chaque configuration, les six succès sont les deux livraisons de Supplier,
Function et de l'objet à double ABI. Six échecs correspondent à l'entier, au
`null` et à l'objet opaque ; les huit autres aux exceptions Supplier, Function,
initialisation statique et stub FFI. Les assertions contrôlent codes, diagnostics,
argument `null`, priorité, appel unique et stdout. Les JAR sont lancés depuis un
dossier contenant seulement `app.jar`, avec le dossier de la JVM seul sur `PATH`.

| Autre contrôle | Résultat |
| --- | --- |
| `./bin/build` | Sonde TAST et reconstruction des 11 modules dépendants du template : **0 erreur, 0 avertissement**. |
| `node test/driver.mjs` | **11 variantes**, aide, **25 échecs attendus**, cycle des sorties et deux invocations Spago réelles ; ABI Supplier et Function exécutées. |
| `node "$PROOF/compare-java.mjs"` | Inventaires des **86 fichiers Java** vérifiés : **76 identiques**, **10 `MainRun.java`** différents uniquement par les trois lignes de la branche de rejet. |
| Empreintes des sources | **51 des 52 fichiers `src/` identiques** à l'entrée M18. Dans `Runtime.purs`, les templates `__IntFn`, `TcoLoop` et les builtins gardent leurs octets. |

La comparaison reprend les TAST/FFI et les 86 références M17, issus du baseline
M14/M15. Leurs SHA-256 sont contrôlés avant et après les douze générations
(onze variantes et entrée vide). La branche autorisée est reconstruite
explicitement par le script ; toute autre différence échoue.

La clôture contrôle syntaxe Node de la nouvelle suite, liens/ancres, exemples
Bash, matrice des **29 suites**, **12 options CLI**, preuves des lots cochés et
`git diff --check`. Les changements de production portent sur le launcher ; le
contrôle d'existence/export au build et le contrôle de valeur effective sur la
JVM gardent leurs phases respectives. L'attente des tâches asynchrones reste à
la charge de l'effet principal suivant le contrat des runtimes.

Preuves locales sous
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m18/` :
`before.json`, `base/`, `reproduce.mjs`, `reproduction.json`, `before-*.log`,
`build-final.log`, `entrypoint-final.log`, `entrypoint-jvm17.log`, `driver.log`,
`compare-java.mjs`, `compare-java.log`, `java-comparison.json`, `driver-compare/`,
`source-checks.json`, `references-final.json` et `checks.json`.

**Conclusion : M18 validé ; complément clôturé. Plans v1 et v2 toujours à 100/100.**

## Nettoyage demandé après M18

**5 octobre 2026 — nettoyage explicite du compilateur et des dossiers `javapurs-*`.**

Référence du compilateur : **`93838ba667ee052789df3f3610e32dfc63ee7225`** ; les
50 dépôts Git examinés étaient propres. Le relevé des 55 dossiers inclut aussi
cinq packages locaux sans dépôt propre. Les références individuelles figurent
dans `inventory.json` du dossier de preuve. Le
[guide d'entretien](maintenance.md#nettoyage-demandé-après-m18) détaille les
catégories retirées et la restauration.

- **177 301 fichiers / 2 963 812 640 octets** retirés : caches, builds de ports,
  trois anciennes sorties `output.bak`, temporaires des tests filesystem,
  métadonnées Finder, classe compilée isolée et sauvegarde Java identifiée.
- **13 738 suppressions suivies** confrontées au manifeste : chaque retrait Git
  appartient à l'inventaire archivé. Les modifications restantes portent sur
  les règles Git et la documentation de ce nettoyage.
- Archive gzip de **330 039 644 octets**, relue intégralement avant retrait avec
  SHA-256 de chaque fichier et contrôle des liens/modes. Une seconde lecture des
  artefacts confirme leur identité avant suppression. Les empreintes des autres
  fichiers, dont les sources et les 2 408 fichiers du build actif, sont préservées.
- `./bin/javapurs --help` : **code 0**, launcher opérationnel après suppression
  des caches locaux.
- `node test/ffi-ports.mjs` : recompilation dans un temporaire avec le `purs` M15,
  Spago **1.0.3**, JDK **26.0.2**, cible **17** ; **17 assertions × 2 modes**,
  sélection FFI locale/registre et exécution JVM réussies. Les 261 cibles du
  nettoyage restent absentes dans les checkouts après ce test.
- Règles Git : **499 sondes d'artefacts ignorés** et **300 sondes de sources
  visibles** sur les 50 dépôts, avec exclusions globales désactivées ; règles
  correspondantes présentes dans les cinq packages locaux. `git diff --check`
  contrôlé sur les 50 dépôts ; liens/ancres et exemples shell vérifiés par
  `node tools/check-docs.mjs`.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-cleanup-628j912y/`,
fichiers `inventory.json`, `manifest.json`, `preserved-before.json`,
`retired-artifacts.tar.gz`, `summary.json`, `categories.json`, `cleanup.log`,
`ffi-ports.log`, `ignore-checks.json`, `status-after-cleanup.json` et `checks.json`.
Ce nettoyage ne change pas les scores des plans ni les clôtures M17/M18.

## Validation M19

**5 octobre 2026 — contrat FFI des exceptions et JAR d'intégration ; lot complémentaire.**

### Constat et références

Avant correction, le nouveau groupe Exceptions donne **9 échecs / 4 réussites** :
`errorWithCause` est nommé `RuntimeException`, les en-têtes affichent la classe
interne Java au lieu du nom de l'erreur, `name` retourne une chaîne vide et un
message natif absent retourne `null`. Le wrapper de `throwException` change
l'identité des exceptions vérifiées et des `java.lang.Error`, y compris via les
handlers, Aff et Promise. La référence JS des noms/en-têtes/causes/identités réussit.
L'intégration PureScript échoue également avec **code JVM 1** sur le nom de
`errorWithCause` ; les deux reproductions sont conservées.

Références au départ, checkouts propres :

| Composant | Révision |
| --- | --- |
| Javapurs | `d708180cc466fcc6c8be1a0f6a3b08e3d8373944` |
| Exceptions | `2cae23930c5f354833a801dc01b37747b04a1546` |
| Aff | `a2497e553efb4416287210332e4fe99e8efd161e` |
| Promise | `669f30715449c521cee990400eb4d7463461833e` |
| Promise/Aff | `debf430c6d2789a709d8f70f4415ce08d4a23db8` |

Outils : Node **24.8.0**, Spago **1.0.3**, binaire `purs` reconstruit en M15
annonçant **`b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16`** sans marqueur `DIRTY`,
SHA-256 **`b0cbba14f64305d70ddfa111a8d9b8907df88cdb4d57159a4805574c5637b549`**.
PBO relevé propre à **`157a544f0a469c7b0137a3fca66e626d717db493`** ; fork propre
au même `b4a7fb1…`. JDK Homebrew **26.0.2** et Temurin **17.0.20.1+1**, macOS arm64.

### Livrables et contrôles ciblés

- [Effect/Exception.java](../../javapurs-exceptions/src/Effect/Exception.java) :
  `Error` pour les deux constructeurs ordinaires/avec cause, `NamedError` héritant
  du même en-tête JS ; propriétés sans nom/message utilisables et relance générique
  sans wrapper. Le [contrat](ffi-runtime.md#exceptions) distingue le nom retourné
  de l'en-tête à nom vide et conserve les frames/causes/suppressed de la JVM.
- `ffi-runtimes.mjs` et `FfiRuntimeChecks.java` : groupe **13 contrôles Exceptions**,
  référence JS exécutée, quatre catégories de Throwable, handler appliqué/forcé
  une fois et exceptions du handler propagées. Le port fournit `bin/test-runtime`.
- `tests/ffi-ports/Main.{purs,java,js}` et `ffi-ports.mjs` : **8 assertions nouvelles**,
  soit 25 au total ; vrai `IOException` observé par identité via `try`, `liftEffect`
  et Promise/Aff. Chaque mode records est lancé en classes puis en JAR autonome ;
  code 0, 25 lignes d'assertions et marqueur final unique exigés.

Depuis le dépôt, `purs` M15 sur `PATH`, `TMPDIR` sous `opencode`, cible commune
**`--release 17`**. Les variables JDK suivent la [recette commune](testing.md#build-jdk-cible-et-jvm).

| Commande / configuration | Résultat |
| --- | --- |
| `JAVA_HOME="$JDK_RECENT_HOME" node test/ffi-runtimes.mjs` | **49 contrôles** : Exceptions 13, Ref 4, Promise 14, Aff 18, avec JDK/JVM 26 ; référence JS réussie. |
| `JAVA_HOME="$JDK17_HOME" ../javapurs-exceptions/bin/test-runtime` | **13 contrôles Exceptions** et référence JS réussis avec JDK/JVM 17 ; launcher également résolu depuis un dossier externe. |
| `JAVA_HOME="$JDK_RECENT_HOME" node test/ffi-ports.mjs` | **25 × 2 modes records × classes/JAR**, soit 100 assertions sur JVM 26 ; rapports FFI et sélection locale/registre réussis. |
| Même commande avec `JAVAPURS_JAVA_RUNTIME="$JDK17_HOME/bin/java"` | Même compilation JDK 26/release 17, **100 assertions réellement exécutées sur JVM 17**, classes/JAR ; mêmes contrôles de sélection FFI. |
| `python3 "$PROOF/compare-java.py"` | **275 TAST** conservés, **423 fichiers Java : 422 identiques / 1 modifié**, exactement par substitution du fragment Exceptions. Le relevé FFI diffère uniquement par son SHA-256. |

La comparaison utilise les sorties de la reproduction initiale et les mêmes
TAST/options/chemins de résolution ; elle contrôle leurs empreintes avant/après.
Les **52 fichiers source du backend** et les sources Aff/Promise/Promise-Aff
gardent leurs empreintes initiales. Le fragment est recompilé par `javac` dans
chaque suite ; les modifications de production sont locales au port Exceptions.
La nouvelle intégration JAR est rejouable par la suite versionnée, depuis un
dossier contenant le seul JAR et avec le dossier JVM seul sur `PATH`.

La clôture actualise TODO, contrats, matrice, README du compilateur/port et
inventaire documentaire. Syntaxes Node/Bash, liens/ancres, **29 suites**,
**12 options CLI**, preuves des lots cochés et `git diff --check` sont contrôlés.

Preuves locales sous
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m19/` :
`before.json`, `Exception.before.java`, `tools.json`, `runtime-before.log`,
`integration-before.log`, workspaces initiaux conservés, `runtime-jdk26.log`,
`runtime-jdk17.log`, `integration-jdk26-jar.log`, `integration-jvm17-jar.log`,
`compare-java.py`, `java-comparison.json`, `frozen-generation.log` et `checks.json`.
Les limites de traces JVM et les versions JDK exécutées restent explicites ;
les autres ports gardent leurs périmètres de couverture datés.

**Conclusion : M19 validé ; complément clôturé. Plans v1 et v2 toujours à 100/100.**

## Revue préalable au plan v3

**6 octobre 2026 — cleanup des fixtures et runners ; ouverture à 0/100.**

Cette revue fonde les quatre lots M20–M23 du [plan actif](../todo.md).
Le [plan v2 archivé](plan-v2.md) conserve ses clôtures et les compléments M17–M19.
La revue porte sur les sources et l'outillage ; elle ne valide aucun lot nouveau.

Références initiales, checkouts propres :

| Dépôt | Révision |
| --- | --- |
| Javapurs | `dc6dadf7d3d0213174bdd3aa65f9288121209c63` |
| Arrays, représentant des launchers identiques | `e4c716465a7502a15e8d8186b2cac988bbddf236` |
| Strings, variante à pile de 64 Mio | `f769f61f6c1b1eb07a7c33f8ea362c9f391a0d70` |

Constats obtenus par lecture et inventaire en lecture seule :

- **52 fichiers / 5 600 lignes dans `src/`**, dont 48 modules PureScript ;
  les responsabilités du backend sont déjà découpées. Les 1 018 fichiers suivis
  de `output/` représentent 5 323 309 octets de build actif, dont le launcher
  dépend ; leur seule présence ne caractérise pas un déchet.
- **Huit suites définissent leur propre `TcoLoop`** : `chunk`, `tco`,
  `counted-loops`, `int-functions`, `loop-invariants`, `ownership`, `direct-calls`
  et `typed-records`. Les deux dernières ont cette copie dans leur parcours
  optionnel sur entrées optimisées externes. Dans `chunk`, `__IntFn` ne possède
  ni l'interface `IntUnaryOperator` ni la méthode `from` du
  [runtime de production](../src/Javapurs/Runtime.purs) ; le `TcoLoop` local
  ne désactive pas non plus `fillInStackTrace`.
- [L'intégration FFI](../test/ffi-ports.mjs) et le
  [runner de ports](../tools/port-test-runner.mjs) ajoutent séparément des
  dépendances par remplacement de texte YAML et les mêmes quatre ports locaux
  Aff, Promise, Promise/Aff et Foreign après `prepareWorkspace`.
- **48 `bin/test` de ports** : **44 fichiers identiques**, un fichier Strings
  différant par les réglages de pile, et trois délégations isolées M12.
  Les 45 premiers retirent les sorties du port, remplacent sa configuration par
  un symlink, ignorent les arguments inconnus et appellent directement les outils
  Java du `PATH`, sans `--release` ni prise en compte de la JVM distincte.
- Les 49 `spago.java.yaml` utilisent le package set **77.7.0**, avec chacun
  48 chemins locaux ; les 49 `spago.yaml` correspondants sont déjà des symlinks.
  Cinq autres ports possèdent un `spago.yaml` régulier. Le runner du compilateur
  utilise **77.10.1**. Un partage de préparation doit rendre ces choix explicites.
- [UUID](../../javapurs-uuid/test/Main.purs) et
  [Yoga JSON](../../javapurs-yoga-json/test/Main.purs) illustrent les suites
  historiques dont `main` utilise `launchAff_` : la migration doit relever le
  protocole de fin, pas seulement reproduire un code de sortie 0.

La comparaison des launchers a utilisé les octets et SHA-256, avec ces deux
empreintes :

| Script | SHA-256 |
| --- | --- |
| `javapurs-arrays/bin/test`, commun à 44 ports | `d3a9a4a64eb70407ad1536acf752033aedf092cb34ad2c3c05a5460e4a253f96` |
| `javapurs-strings/bin/test` | `03f38deb39142b430bc74d7692ac7da70f5880752d783fedb01feb53d1689edb` |

**Sonde comportementale isolée :** copier chacun de ces deux scripts dans un
port temporaire ; créer des sentinelles `output/keep` et `java_output/keep`,
un `spago.yaml` régulier et un `spago.java.yaml` distinct ; placer un faux
`spago` retournant 37 devant `/usr/bin:/bin` dans `PATH` ; appeler
`/bin/bash <copie>/bin/test --clena` depuis le dossier parent.

Pour les deux copies, la commande a atteint « Building project with spago »
et quitté avec **1** après l'échec simulé de Spago. Les deux sentinelles avaient
été retirées et `spago.yaml` remplacé par un symlink. Cela reproduit l'absence de
validation des options avant mutation, sans exécuter de compilateur réel. Les
dossiers temporaires de la sonde ont été supprimés ; les ports sources n'ont
pas été modifiés.

**Périmètre :** inventaires statiques et deux sondes de launchers copiés,
sans campagne de ports ni validation fonctionnelle supplémentaire du compilateur.
Le score du plan v3 reste **0/100** jusqu'aux validations de ses lots.

## Validation M20

**6 octobre 2026 — fixtures compilées avec le runtime de production ; 20/100.**

### Références et périmètre

- Backend : `dc6dadf7d3d0213174bdd3aa65f9288121209c63`, avec les modifications
  documentaires d'ouverture du plan v3 déjà présentes au départ. Les tests,
  sources et modules construits n'avaient pas de modification locale.
- Entrées de benchmark : checkout `altbak.pub-javapurs` à
  `ada9eb2276083dfb590bb35a10c935a9a8d3722e`, propre. Copie figée de **38 fichiers
  TAST** : RBTree, Records, Church, LazyEvaluation et fermeture de leurs imports ;
  quatre sources PureScript et quatre anciens `.purmeta` également inventoriés.
  Les anciens caches servent au constat initial, pas au build de validation.
- Node **24.8.0**, JDK/JVM Homebrew **26.0.2**, cible **17**. Chemins exacts,
  variables du runner, commandes et SHA-256 sont dans les preuves locales.

Les huit suites retirent leurs copies de `TcoLoop`, ainsi que le `__IntFn`
réduit de `chunk`. Elles importent `tcoLoopSource`/`intFunctionSource` depuis
`output/Javapurs.Runtime/index.js` et compilent les fichiers correspondants.
Assertions AST/JVM, modes, entrées sémantiques, timeouts et réglages de pile sont
conservés.

**Constat supplémentaire reproduit avant correction :** les neuf commandes
standard réussissaient ; les cinq invocations optionnelles échouaient en lisant
des caches pourtant présents. Le PBO construit démarre avec une portée de
publication vide, donc `readPurmetaSync` retourne `Nothing` pour ces fichiers
produits par un autre processus. La correction commune des quatre consommateurs
reconstruit leurs implémentations via
[optimized-module.mjs](../test/support/optimized-module.mjs), dans le même scope
que leur lecture, sans assouplir le contrat du cache.

Pour isoler l'effet du retrait des runtimes copiés, les cinq parcours optionnels
de la référence ont reçu la même préparation TAST corrigée, tout en gardant leurs
anciens templates locaux. Cette référence effective et la version finale
utilisent les mêmes 38 TAST et les mêmes modules construits du backend.

### Commandes et résultats

Chaque ligne a réussi sur la référence effective puis sur la version finale.
`INPUTS` désigne le dossier figé décrit ci-dessus.

| Commande ciblée | Résultat |
| --- | --- |
| `node test/chunk.mjs` | **15 fixtures** réussies, avec les interfaces/runtime de production. |
| `node test/tco.mjs` | **16 cas comportementaux**, dont replis et sauts entre boucles. |
| `node test/counted-loops.mjs` | **51 admissions/refus**, comportements JVM, overflow et replis réussis. |
| `node test/int-functions.mjs` | Modes générique/spécialisé réussis : ABI, ordre, captures, exceptions et TCO profond. |
| `node test/int-functions.mjs --church-project "$INPUTS"` | Les deux modes précédents avec Church optimisé, dont pont avec fonction FFI ordinaire. |
| `node test/loop-invariants.mjs` | **23 contrôles de pureté, 13 de portée, 50 JVM**. |
| `node test/loop-invariants.mjs --lazy-project "$INPUTS"` | Mêmes contrôles, plus invariant réel LazyEvaluation et génération désactivée vérifiés. |
| `node test/ownership.mjs` | Workers, arbre persistant/consommé, listes polymorphes et groupe récursif local réussis. |
| `node test/direct-calls.mjs` | **37 contrôles JVM × 2 modes**. |
| `node test/direct-calls.mjs --rbtree-project "$INPUTS"` | **56 contrôles JVM × 2 modes**, dont rotations/invariants RBTree et ordre des valeurs. |
| `node test/typed-records.mjs`, puis `--records=maps` | **75 / 69 contrôles JVM**. |
| `node test/typed-records.mjs --records-project "$INPUTS"`, puis ajout de `--records=maps` | **100 / 94 contrôles JVM**, dont mises à jour profondes optimisées ; six lectures de paramètre sans annotation locale. |

Soit **14 commandes réussies et 18 variantes compilées/exécutées sur JVM** par
version effective. Trois sondes supplémentaires du nouveau support réussissent :

1. Cache résiduel volontairement invalide ignoré ; implémentations fraîchement
   construites disponibles, tous les fichiers du projet préservés et workspace
   temporaire supprimé au succès.
2. `typeTable` invalide refusé par le loader de production, dossier appelant
   préservé et workspace en échec conservé.
3. Erreur d'écriture `.purmeta` injectée et propagée ; dossier appelant restauré,
   scope de publication réinitialisé et ancien cache du projet intact.

### Comparaison et clôture

Captures des sources Java écrites par les suites, avant leur nettoyage normal :

- **104 fichiers identiques** à l'octet près.
- **11 fichiers `TcoLoop.java` remplacés** exactement par le template courant.
- **3 harness Java** conservés à l'octet près après retrait de leurs seules
  définitions runtime terminales (`ChunkRuntime`, `TcoPrinterRegression`,
  `CountedLoopRegression`).
- **4 fichiers ajoutés** : `TcoLoop.java` dans ces trois workspaces et
  `__IntFn.java` dans celui de `chunk`, tous identiques aux templates construits.

Inventaires : **118 sources avant / 122 après**. Les **52 fichiers de `src/`**,
les **1 018 fichiers du build `output/`** et les **46 entrées figées/inventoriées**
gardent leurs empreintes ; le checkout du benchmark garde également ses fichiers.
Les changements concernent huit suites et un helper de test ; aucune génération
de production n'a été modifiée pour les faire passer.

Limites : cette validation utilise JVM 26 avec bytecode cible 17 ; elle n'est pas
une nouvelle matrice inter-JDK. Le parcours optionnel `int-loops` décrit plus
haut garde sa limitation préexistante et n'est pas couvert par M20.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m20-mgceekkm/`,
notamment `references.json`, `inputs/`, `base/`, `before/` (y compris les cinq
échecs initiaux), `before-prepared/`, `after/`, `comparison.json`, `capture.mjs`,
`run-suites.py`, `helper-probes.mjs` et les workspaces des sondes négatives.
La revue finale contrôle le diff, l'absence de copies runtime dans `test/`,
les liens, exemples shell et le score du plan.

**Conclusion : M20 validé, +20 points ; plan v3 à 20/100, 1 lot sur 4.
Prochain lot : M21 — préparation déclarative des workspaces de test.**

## Validation M21

**6 octobre 2026 — profils partagés et configuration des workspaces ; 45/100.**

### Références et périmètre

- Backend : `dc6dadf7d3d0213174bdd3aa65f9288121209c63`, avec les modifications
  documentaires et M20 déjà présentes au départ, conservées dans le diff initial.
- **23 ports locaux propres** au départ, inventoriés avec révision, fichiers,
  SHA-256, répertoires et cibles des symlinks. Les quatre sélections partagées :

| Port | Révision |
| --- | --- |
| Aff | `a2497e553efb4416287210332e4fe99e8efd161e` |
| Promise | `669f30715449c521cee990400eb4d7463461833e` |
| Promise/Aff | `debf430c6d2789a709d8f70f4415ce08d4a23db8` |
| Foreign | `c7d5403aea3ea607d731987d6406418a0e5d4cce` |

- Node **24.8.0**, Spago **1.0.3**, `purs` **0.15.16**, étiquette du binaire
  `3c8fcfd7a3d440bba487fe9fe059284cffc6e908 DIRTY` ; JDK/JVM Homebrew
  **26.0.2**, `JAVAPURS_JAVA_RELEASE=17`.
- Fichiers de code : nouveau [workspace-config.mjs](../tools/workspace-config.mjs),
  [fixture-runner.mjs](../tools/fixture-runner.mjs),
  [port-test-runner.mjs](../tools/port-test-runner.mjs),
  [ffi-ports.mjs](../test/ffi-ports.mjs) et [test-tools.mjs](../test/test-tools.mjs).

Les profils conservent les différences de dépendances directes et partagent la
sélection Aff/Promise/Promise-Aff/Foreign. L'intégration utilise également cette
préparation pour sélectionner `foreign` dans le registre lors de sa sonde négative.
Le lecteur du sous-ensemble de gabarit documenté refuse structures inattendues,
doublons, conflits de chemins et checkouts manquants avant écriture ; il conserve
le package set explicite et le bloc de test optionnel. Le gabarit du runner reste
la source de l'inventaire de base.

### Commandes et résultats

| Commande ciblée | Résultat |
| --- | --- |
| `node test/test-tools.mjs` | **18 tests réussis**, dont cinq nouveaux groupes de préparation : profils/Foreign registre, gabarit alternatif 77.7.0/entrypoint, neuf gabarits invalides et sélections erronées, checkouts absents/non-répertoires/conflits, préservation du gabarit et des configurations liées. Le pipeline simulé utilise des chemins avec espaces et vérifie les FFI auxiliaires/originaux. |
| `node test/ffi-ports.mjs` | **25 assertions × records typés/Maps × classes/JAR**, inventaires et marqueurs finaux vérifiés. Sélection des fragments locaux et relevé identique entre représentations ; génération avec Foreign du registre diagnostiquée `missing`, source Spago identifiée. |
| `node test/port-runners.mjs --port=aff` | **45 contrôles**, marqueur de fin et quatre sondes négatives réussis. |
| `node test/port-runners.mjs --port=promise` | **13 contrôles**, marqueur de fin et quatre sondes négatives réussis. |
| `node test/port-runners.mjs --port=promise-aff` | **7 contrôles**, marqueur de fin et quatre sondes négatives réussis. |

Les quatre commandes réelles utilisent un `TMPDIR` contenant des espaces. Les
**12 sondes négatives** vérifient assertion après suspension, rejet, timeout
interne et sortie prématurée sans marqueur. Les phases gardent leurs logs,
bornes et paramètres Java ; les workspaces des suites sont supprimés au succès.

Le script de collecte avait initialement exigé un `TMPDIR` entièrement vide,
après les quatre codes de sortie 0. Il a trouvé le dossier `spago-nodejs` et ses
répertoires vides, sans fichier. Le contrôle corrigé distingue ce scratch Spago
des workspaces des runners : aucun de ceux-ci n'est resté. Ce contrôle final a
été rejoué sur les résultats conservés, sans relancer les quatre suites réussies.

### Conservation et clôture

Avant modification, capture de la préparation existante de la fixture, de
l'intégration et des trois ports, y compris le bloc original de composition de
`ffi-ports.mjs`. Après modification, même préparation par les profils communs :
**21 fichiers identiques à l'octet près**, dont **cinq configurations Spago** et
**16 sources/FFI de suites**. Les dépendances, versions de package set, chemins
locaux et fichiers copiés de ces parcours sont ainsi conservés.

L'inventaire final est identique pour les **23 ports locaux**, le gabarit
`tests/runner/spago.yaml`, les **52 fichiers de `src/`** et les **1 018 fichiers
du build `output/`**. Le contrôle documentaire et `git diff --check` complètent
la revue des diffs du compilateur et du TODO parent.

La validation utilise JVM 26 avec cible 17. Le gabarit alternatif 77.7.0 est
couvert par les sondes Node ; les exécutions réelles de ce lot utilisent le
runner 77.10.1. La migration des launchers historiques relève de M22–M23.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m21-TonoZh/`,
notamment `references.json`, `before-inventory.json`, `after-inventory.json`,
`base/`, `before/`, `after/`, `preparation-comparison.json`, `test-tools.log`,
les quatre logs d'intégration/ports, `validation.json`, `workspace-cleanup.json`
et les scripts de capture, comparaison et exécution.

**Conclusion : M21 validé, +25 points ; plan v3 à 45/100, 2 lots sur 4.
Prochain lot : M22 — runner commun et pilotes Refs, Exceptions, Strings.**

## Validation M22

**6 octobre 2026 — runner commun et trois migrations pilotes ; 80/100.**

### Références et contrat

Le compilateur reste à `dc6dadf7d3d0213174bdd3aa65f9288121209c63`, avec les
modifications M20/M21 déjà présentes au départ. Les trois ports pilotes étaient
propres avant cette passe :

| Port | Révision | Entrée de référence |
| --- | --- | --- |
| Refs | `c8e66b9acde8dda2a0e7271fb4175dd20cf3d5ae` | `test/Main.purs`, cinq assertions, dont deux via `selfRef`. |
| Exceptions | `d47b968ffe098b66c6e5573ee4f7c23c4d57c8f2` | `test/Main.purs`, erreurs et propriétés, log final `All tests passed`. |
| Strings | `f769f61f6c1b1eb07a7c33f8ea362c9f391a0d70` | `test/Test/Main.purs`, huit modules de test appelés séquentiellement. |

Leurs `main :: Effect Unit` sont synchrones. Les ressources résident dans `src/`
et `test/`, avec les fragments FFI adjacents ; les arbres sont conservés par copie.
Chaque port garde son gabarit `spago.java.yaml`, son package set **77.7.0** et ses
dépendances de package/test. Les wrappers Aff/Promise gardent le runner **77.10.1**,
leurs attentes, marqueurs et sondes négatives.

Les trois `bin/test` deviennent des délégations de quatre lignes. Le parcours
commun de [port-test-runner.mjs](../tools/port-test-runner.mjs) et
[port-runners.mjs](../test/port-runners.mjs) livre : options strictes avant effets,
aide sans JDK/build, `-c` via `bin/build` avec environnement résolu, workspace
isolé, phases bornées et logs conservés à l'échec, propagation des signaux,
cible/JVM séparées et pile Strings de **64 Mio** pour `javac` et `java`.

### Exécutions et sondes

Node **24.8.0**, Spago **1.0.3**, `purs` **0.15.16** portant l'étiquette
`3c8fcfd7a3d440bba487fe9fe059284cffc6e908 DIRTY`. JDK de build Homebrew
**26.0.2** ; JVM 26.0.2 puis Temurin **17.0.20.1+1** pour la sélection croisée.
Le JDK 17 a été téléchargé depuis la release épinglée de M16 ; SHA-256 vérifié :
`196d13ba5f10414bef7f6a05a9b3f00edacb18ebacef2b99485db9e2ee18f0e8`.

**Référence préalable :** les trois launchers historiques ont réussi dans des
copies isolées, avant modification des ports. Seuls les chemins locaux de leurs
gabarits copiés ont été rebasés vers les checkouts inventoriés. Les scripts ont
conservé leurs arguments Java historiques, sans cible explicite. Leurs TAST,
sources Java, relevés FFI et logs ont été figés.

| Commande / sélection finale | Résultat |
| --- | --- |
| `node test/test-tools.mjs` | **24 tests Node réussis**. Six nouveaux groupes couvrent aide/options/délégations des trois pilotes, cibles 17/26 et JVM distincte, pile Strings, cinq échecs de phase, launcher Java manquant, quatre timeouts et SIGINT/SIGTERM aux descendants. Sources, configurations liées, lockfiles et anciens outputs sentinelles sont préservés. |
| `../javapurs-refs/bin/test` | Suite réelle réussie depuis un dossier externe ; nouveau workspace, package set 77.7.0, cible 17 et JVM 26. |
| `../javapurs-exceptions/bin/test` | Suite réelle réussie dans les mêmes conditions ; assertions et message final conservés. |
| `../javapurs-strings/bin/test` | Huit modules de suite exécutés ; `javac --release 17 -J-Xss64m` et JVM `-Xss64m` effectifs. |
| `JAVAPURS_JAVA_RUNTIME="$JDK17_HOME/bin/java" ../javapurs-refs/bin/test` | Compilation par JDK 26 en release 17, exécution réelle sur **JVM 17**. `MainRun.class` a la version majeure **61**. |
| `node test/port-runners.mjs --port=aff` | **45 contrôles + quatre sondes négatives** réussis. |
| `node test/port-runners.mjs --port=promise` | **13 contrôles + quatre sondes négatives** réussis. |
| `node test/port-runners.mjs --port=promise-aff` | **7 contrôles + quatre sondes négatives** réussis. |

Les sept sélections réelles utilisent un `TMPDIR` avec espaces. Pour les sondes
de timeout, l'adaptateur de test vérifie les bornes de production **120 s / 45 s**
puis réduit la phase bloquée à 200 ms ; l'escalade SIGKILL est exercée. Les erreurs
de build passent également par un log et un workspace conservés. Les interruptions
des launchers retournent **130/143**, avec réception du signal par le petit-fils.

La première collecte réelle a rencontré **ENOSPC** : Strings/Spago et Aff/PBO
ont signalé l'écriture impossible, puis Spago a remonté une erreur d'I/O SQLite.
Exceptions et Refs/JVM17 avaient fini leur suite mais leur copie de preuve avait
échoué. Les preuves partielles ont été archivées et relues octet par octet ; la
capture a été réduite aux sources/FFI, Java/classes, logs et configurations,
avec inventaire des TAST. Les six sélections en échec ont ensuite réussi ; Refs,
déjà réussi avec capture complète, a été conservé. Aucun échec n'a été converti
en succès par le runner et aucun correctif du backend n'a été nécessaire.

### Comparaison et conservation

Rejeu du nouveau pipeline sur les **mêmes TAST figés**, avec les mêmes sources
et fragments FFI ; seule la phase Spago est remplacée par la reprise des fichiers
dont les SHA-256 sont vérifiés. Génération, `javac` et exécution restent réels :

| Pilote | Fichiers TAST | Java identiques | Entrées du relevé FFI identiques |
| --- | ---: | ---: | ---: |
| Refs | 161 | 269 | 161 |
| Exceptions | 250 | 397 | 250 |
| Strings | 193 | 306 | 193 |
| **Total par workspace** | **604** | **972** | **604** |

Les rapports FFI sont comparés après normalisation des seules racines temporaires :
origines, résolution, statuts, bindings et empreintes des fragments sont identiques.
Les **972 Java** des builds Spago neufs de la sélection finale correspondent aussi
à cette référence, octet par octet. Les sources et modes sémantiques des suites
n'ont pas été retouchés.

L'inventaire des ports et les empreintes du backend sont revérifiés à la clôture ;
seuls `bin/test` et `README.md` des trois pilotes changent dans les ports. Les
configurations, symlinks, lockfiles et anciens outputs sont conservés. Les contrôles
documentaires, la syntaxe Bash des délégations, `git diff --check` dans les quatre
dépôts touchés et la revue du TODO parent complètent la validation.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m22-guTuD1/`,
dont `references.json`, inventaires avant/après, `legacy workspaces/`, `after/`,
`frozen workspaces/`, `frozen-comparison.json`, `validation.json`, `jdk17.json`,
`test-tools.log`, `initial-enospc.tar.gz`, `initial-enospc/` et `final-audit.json`.
Les scripts de capture, de reprise et de comparaison sont conservés avec ces preuves.

Le périmètre réel couvre ces six ports et le croisement JVM 17 de Refs. Les
**42 launchers historiques restants** relèvent de M23 et de sa sélection bornée.

**Conclusion : M22 validé, +35 points ; plan v3 à 80/100, 3 lots sur 4.
Prochain lot : M23 — migration des 42 autres launchers historiques.**

## Validation M23

**6 octobre 2026 — migration des 42 launchers restants ; plan v3 à 100/100.**

### Références et inventaire

Javapurs reste à `dc6dadf7d3d0213174bdd3aa65f9288121209c63`, avec les
modifications M20–M22 non commitées déjà présentes. Les 42 ports à migrer sont
propres ; les trois pilotes conservent leurs changements M22. Le
[relevé exhaustif](port-launchers.md) donne les **45 révisions historiques**,
destinations, entrypoints, ressources, piles, configurations et résultats par
port. Les 54 dossiers de ports locaux et les sources/builds du backend ont une
empreinte préalable. Aucun commit ni push n'est réalisé.

Outils : Node **24.8.0**, Spago **1.0.3**, JDK/JVM Homebrew **26.0.2**, `purs`
**0.15.16**, build `3c8fcfd7a3d440bba487fe9fe059284cffc6e908 DIRTY`.
Les nouvelles compilations ciblent **release 17** ; la preuve JVM 17 des pilotes
reste celle de M22. Les références historiques utilisent les options originales,
sans `--release`. La sélection réelle est nommée et séquentielle ; aucun `t -c`,
corpus entier ni `modtest`.

### Livrables

- **42 délégations de quatre lignes**, rejoignant les trois pilotes et les
  trois ports M12 : **48 launchers communs**. Les options/arguments, modes
  exécutables et destinations sont contrôlés. Les migrations couvrent le groupe
  synchrone, les deux Spec attendues, puis les six protocoles explicitement rejetés.
- **37 profils historiques synchrones**, dont Prelude et Partial déjà acceptés
  via `Function.apply(null)` par `MainRun`, **deux profils Spec/Aff** et **six
  profils non pris en charge**. Les listes de dépendances vides `[]` des gabarits
  Prelude/Partial sont désormais lues et réémises explicitement.
- UUID et Node Event Emitter exposent `spec :: Spec Unit` ; les assertions
  d'origine sont conservées. Le wrapper `tests/port-suites/Spec.purs` attend
  `evalSpecT` sans sortie de processus, rejette les résultats failed/pending et
  publie un nombre de succès vérifié par le launcher. Le support Java sépare
  `Aff.java` et `Promise.java` du cœur commun `Runner.java`, sans ajouter Promise
  au graphe des ports Spec.
- Node FS/HTTP/Net/Streams, Spec et Yoga JSON échouent explicitement avant outils,
  build et workspace. Leurs sources restent intactes ; le diagnostic décrit le
  protocole détaché ou les callbacks qui empêchent de prouver leur fin.
- Les 42 README sont actualisés. `check-docs.mjs` couvre désormais les **48
  README** de ports et l'inventaire des launchers. Cinq liens locaux préexistants
  cassés dans ces README sont corrigés lors de l'extension de ce contrôle.

### Commandes et résultats

Les commandes ci-dessous partent du compilateur ; la collection a aussi lancé
les scripts par leur chemin absolu depuis un dossier tiers.

| Commande / sonde | Résultat |
| --- | --- |
| Référence `--clena` des 42 anciens scripts, commandes simulées sur copies | Les 42 atteignent Spago après suppression des outputs et remplacement de configuration ; sortie 1 du faux Spago. Le défaut historique est enregistré avant migration. |
| Références réelles Arrays, Node Path, UUID, Node Event Emitter, Prelude, Partial, Console | Sept codes 0 avec les scripts d'origine sur copies isolées. Les deux Spec n'impriment aucun résultat avant la sortie JVM : ce code 0 n'établit pas leur complétion. |
| `node test/test-tools.mjs` | **27 tests Node réussis** : aide/arguments des 45 délégations, gabarits/dépendances/chemins, ressources/FFI, absence de mutation, empty lists, six rejets avant effets, Spec incomplète/sans marqueur ; garanties M22 de cible/JVM/pile, erreurs, timeouts et signaux conservées. |
| `../javapurs-arrays/bin/test` ; `../javapurs-node-path/bin/test` | **Réussis**, vrais pipelines en release 17. |
| `../javapurs-prelude/bin/test` ; `../javapurs-partial/bin/test` | **Réussis**, entrypoints fonctionnels et dépendances directes vides ; Partial reste un smoke test sans assertions. |
| `../javapurs-console/bin/test` | **Réussi**, ressource `test/expected_output.txt` copiée ; mêmes messages qu'à la référence, sans ajouter de comparaison absente du test initial. |
| `../javapurs-refs/bin/test` ; `../javapurs-exceptions/bin/test` ; `../javapurs-strings/bin/test` | **Trois pilotes réussis**, pile Strings 64 Mio conservée. |
| `../javapurs-uuid/bin/test` | **Six tests et cinq sondes négatives réussis** : assertion suspendue, rejet, timeout, sortie prématurée, assertion capturée par Spec. |
| `../javapurs-node-event-emitter/bin/test` | **Échec visible, code 1 : 1/14 tests passent**, erreurs `Boolean cannot be cast to Supplier`. Pas de marqueur ni de succès de remplacement. |
| Classes historiques Event Emitter + `BaselineWait` maintenant le thread principal en vie | **Même échec, code 1, 1/14** avec les classes compilées avant modification ; les échecs précédemment masqués sont préexistants. |
| `checkPortRunner("node-event-emitter", …)` sur les classes de la suite en échec | **Cinq sondes négatives réussies**, exécutées séparément car le parcours normal s'arrête correctement à l'échec de la suite. |
| `../javapurs-aff/bin/test` ; `../javapurs-js-promise/bin/test` ; `../javapurs-js-promise-aff/bin/test` | **45/13/7 contrôles et 12 sondes négatives réussis** après composition du support Java. |
| `../javapurs-node-fs/bin/test` ; `../javapurs-node-http/bin/test` ; `../javapurs-node-net/bin/test` ; `../javapurs-node-streams/bin/test` ; `../javapurs-spec/bin/test` ; `../javapurs-yoga-json/bin/test` | **Six codes 1 et diagnostics de protocole attendus**, avant préparation ; leurs suites ne sont pas déclarées validées. |
| Audit, syntaxe Bash et `git diff --check` | **54 ports préservés** hors des 42 launchers/README et des deux extractions de Spec prévues ; 48 launchers exécutables et syntaxiquement valides ; aucun écart de whitespace dans les dépôts touchés. |
| `node tools/check-docs.mjs` | **651 liens/ancres, 53 exemples Bash et 63 documents** vérifiés ; 29 suites, 12 options CLI, progression **100/100 — 4/4 lots**. |

Au total : **13 suites réellement construites/exécutées**, **12 réussites**,
**un échec FFI préexistant désormais observé**, **22 sondes asynchrones négatives
réussies** et **six refus explicites de protocole**. Les **29 autres suites
historiques synchrones** ont leurs délégations/gabarits vérifiés avec commandes
simulées ; elles ne sont pas ajoutées à la couverture sémantique réelle.

Le premier essai UUID a révélé deux imports auxiliaires absents de son graphe
(`Effect.Console`, `Test.Assert`). Le wrapper utilise maintenant `Test.Spec.Console`
et `Test.Spec.Assertions`, déjà présents, puis la sélection est rejouée avec
succès. Cette correction conserve les dépendances et configurations originales.

### Comparaison et préservation

Sur Arrays, Node Path, Prelude, Partial et Console, les cinq builds de référence
et les nouveaux builds produisent **1 479 Java** : **1 271 identiques octet pour
octet**, **208 ne différant que par le commentaire du chemin FFI relatif**,
la racine du workspace ayant un niveau de profondeur différent. Les fichiers
sont identiques après ce seul rebasage ; les **cinq rapports FFI sont identiques**
après normalisation des racines temporaires. Aucun changement de génération
n'est introduit. Les **52 fichiers source du backend et ses 1 018 fichiers de
build** gardent leurs empreintes.

L'audit des 54 ports conserve `src/`, configurations, symlinks, lockfiles, caches,
outputs et ressources, y compris les anciens temporaires Node FS. Les seuls
changements de tests sont les deux extractions de Spec ; le corps des six tests
UUID est comparé à sa référence en ignorant uniquement l'indentation, et les
tests Event Emitter résident dans un module auxiliaire inchangé. Les changements
M20–M22 restent présents.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m23-hchnV9/`.
Le dossier contient `references.json`, `port-inventory.json`, l'inventaire initial,
les scripts/résultats de référence, `validation.json`, `test-tools.log`, les logs
et captures ciblées `after/`, `java-comparison.json`, `baseline-event-wait.log`,
`event-probes.log`, `final-audit.json` et les diffs. Les références complètes et
workspaces en échec sont archivés en `.tar.gz`, vérifiés octet par octet avant
retrait de leur copie extraite ; les premiers essais sont conservés sous `initial/`.

**Conclusion : M23 validé, +20 points ; plan v3 à 100/100, quatre lots sur quatre.
La migration d'outillage est terminée. Les six protocoles non pris en charge,
l'échec Event Emitter et les suites non exécutées restent des limites explicites.**

## Validation M24

### Périmètre et références — 8–9 octobre 2026

Demande : corriger le conflit `output/classes/corefn.json` de b8x et regrouper
les sorties Javapurs sous le dossier `output` commun aux backends. Le défaut
devient `<input>/java/` ; `--java-output` reste un override explicite. Les runners
et exemples compilent sous `output/java/classes/`. Le lecteur réserve uniquement
`java/` en minuscules et conserve les erreurs des autres entrées invalides.

Références de départ : Javapurs `c05b2b3b14d657469b72113ce22e9f308d9eb9d1`,
PBO Java `ce24af533bf39e50a4cb20931f86488b8fa1f589`, fork source
`105f5752b39cc0f6c99a40064295338bf57ad223`, b8x
`cc9e5ce17352817a19ac0cb5dcb28507d190a4c8`. Javapurs et PBO sont propres au
départ ; les modifications applicatives, Rust, PHP et liens b8x préexistants
sont relevés séparément. Le build du backend remet aussi ses modules PBO
construits à jour avec les sources déjà présentes à `ce24af5`.

Outils réellement sélectionnés : Node 24.8.0, Spago 1.0.3, OpenJDK 26.0.2,
bytecode cible 17. Le `purs` actif est `~/.local/bin/purs`, annoncé `0.15.16`
avec `3c8fcfd7… DIRTY`, SHA-256
`758f82437163403272d9537eb934231f17d6efbe147f6107c276d257643a30d2`.
La sonde de `bin/build` confirme les trois métadonnées TAST enrichies ; les
anciens outils temporaires M15/M16 ne sont plus présents. L'essai avec l'ancien
chemin JVM17 échoue au contrôle d'exécutable avant compilation et est consigné.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `./bin/build` du backend | 460 modules reconstruits, sonde TAST réussie. |
| `node test/driver.mjs --record …`, puis `--compare …` | 11 variantes, aide, 25 refus attendus et cycle de publication ; **86 Java identiques** sur TAST/FFI figés. Trois builds Spago avec JVM réussis, dont deux consécutifs et une entrée personnalisée avec espaces. |
| `node test/input.mjs` | **29 entrées invalides / 116 refus attendus** ; Java, manifeste, classes sentinelles et caches préservés. Un dossier `output/classes` reste refusé, alors que `output/java/classes` est accepté. |
| `node --test test/output-files.mjs test/test-tools.mjs` | **37/37 tests** ; publication/rollback, sous-arbre réservé, symlinks, sélection et délégation des runners. |
| `node test/entrypoint.mjs` | **10 variantes, 6 succès et 14 échecs JVM attendus**, classes et JAR. |
| `node test/ffi-diagnostics.mjs` | 8 rapports, 3 résolutions, 8 refus JVM ciblés, 2 membres manquants refusés par javac et 1 erreur de lecture attendue. |
| `node test/ffi-ports.mjs` | **25 assertions × 2 représentations × classes/JAR = 100 assertions**, sélection FFI locale/registre vérifiée. |
| `node tools/source-smoke.mjs …` | Hello/Refs reconstruits, classes et JAR autonomes exécutés ; bytecode 61. |
| Fixture isolée `BigFunction`, runners isolés `refs` et `aff` | BigFunction et Refs réussis ; **45 contrôles Aff** et quatre sondes de terminaison/échec réussis. |
| `node test/direct-calls.mjs`, après reproduction négative de la nouvelle régression | **40 contrôles JVM × deux modes**, admission et taille bornée ; 32 appels imbriqués, ordre des effets et échec d'initialisation réentrante. |
| `node test/constructor-reuse.mjs` ; `node test/chunk.mjs` | **7 groupes Reuse**, **15 fixtures Chunk** réussis. |
| `node test/representations.mjs` après correction des gardes | **43 assertions JVM × huit modes = 344**, ABI, records typés/Maps, fonctions Int/génériques et appels directs on/off. |
| Rejeu du driver et de BigFunction après correction des gardes | **86 Java du driver et 329 Java BigFunction identiques** aux références figées. |
| `node --test bin/tests/build.test.mjs` dans b8x | **6/6 tests** : routage, destination Java, retrait du bytecode obsolète, launcher de production et code d'échec javac propagé. |
| Premier essai `bin/build` b8x, heap par défaut 16 Gio | Les **2 685 TAST** sont chargés ; l'erreur `classes/corefn.json` est résolue. Échec mémoire Node pendant `Inter.Cli.Logic.Registry`, avant publication ; cause et correction ci-dessous. |
| Premier `./bin/build` b8x après correction, heap par défaut 16 Gio | **Code 0** ; backend en **60 943 ms**, **2 687 sources gérées** et **9 launchers** publiés puis compilés par JDK 26.0.2 en release 17. Empreintes du manifeste vérifiées. |
| `./bin/run Ping` après le premier build corrigé | **Code 0, `pong`**, via le classpath `output/java/classes` du conteneur `core-api-cli-1`, OpenJDK **17.0.20.1**. |
| Second `./bin/build` b8x consécutif, classes déjà présentes | **Code 0 en 617,975 s**, dont backend **58 277 ms**, heap habituel de 16 Gio. **2 685 TAST, 2 696 Java et manifeste strictement identiques** au premier build ; **39 189 classes**, toutes en version majeure **61**. Marqueur présent, anciens chemins `java_output` et `output/classes` absents. |
| `./bin/run Ping` après le second build | **Code 0, `pong`** sur la même JVM 17. Les deux générations ont chacune été compilées et exécutées. |
| Revue finale, syntaxe Bash/Node, `git diff --check` et `node tools/check-docs.mjs` | Contrôles réussis ; sauvegarde de migration revérifiée par SHA-256, 11 diffs b8x préexistants conservés, FFI construites alignées sur leurs sources et instrumentation limitée aux copies temporaires. |

Les liens du TODO, désormais suivi dans le dépôt du compilateur, et son chemin
dans `check-docs.mjs` sont corrigés : le contrôle initial échouait sur
`README.md -> ../todo.md` absent.

### Expansion des gardes d'appels directs

Le premier échec mémoire apparaît pendant `Reuse.reuseConstructors`, après
`DirectCalls`. Une instrumentation isolée du module `Inter.Cli.Logic.Registry`
montre que les gardes lazy imbriquées partagent chaque argument entre branches
lente/directe, puis dupliquent récursivement ces sous-arbres. Le graphe de
179 555 objets représente **7 202 796 762 objets après dépliage** ; le parcours
arborescent de Reuse révèle cette expansion. L'essai avec 32 Gio autorisés est
arrêté au même module après une empreinte mesurée de 24,8 Gio.

La correction est limitée à `DirectCalls` : une nouvelle garde n'est pas ajoutée
autour d'une garde déjà introduite dans ses enfants. L'appel extérieur reste
curryfié ; les appels directs non gardés, les gardes indépendantes et les
auto-appels saturés conservent leur admission. Aucun argument n'est anticipé ni
mis en cache. La nouvelle régression échoue sur la version précédente avant
les tests JVM ; les tests corrigés vérifient taille, ordre d'évaluation et
moment de l'échec sur champ encore nul.
Sur les mêmes TAST, le graphe corrigé contient **175 847 objets uniques** et
**180 085 objets après dépliage**, relevés dans `registry-graph-comparison.json`.

### Migration des anciens artefacts b8x

Les **3 482 sources Java suivies**, soit **68 670 327 octets**, de `java_output/`
et les **40 879 fichiers** de `run/bak/java/output/classes`, soit **70 229 868
octets**, sont déplacés vers la sauvegarde locale `b8x-legacy/` et vérifiés par
SHA-256 avant/après. Le nouvel arbre est régénéré ; `output/` est déjà ignoré,
et `/java_output/` est ajouté aux exclusions historiques. Le build produit ses
launchers via le modèle `Runtime.mainRunSource`, après une seule génération
`--records=maps --no-main` ; ses classes et son marqueur `.javapurs` sont dans
`output/java/classes/`, également utilisé par `bin/run` dans Docker.

Preuves locales :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m24/`.
Inventaires et références : `references.json`, `b8x-before.json`,
`javapurs-before.json`, `b8x-migration.json`, snapshots `driver-baseline/`,
logs nommés par contrôle, workspaces `BigFunction/`, `port-refs/`, `port-aff/`
et `source-smoke/`. Les deux builds sont consignés dans
`b8x-build-fixed-{1,2}.log`, `b8x-{first,second}-generation.json` et
`b8x-second-build.json` ; leurs exécutions dans `b8x-ping-{1,2}.log`.
`final-audit.json` et `ports-final.json` relèvent l'état final des dépôts et
la vérification des sauvegardes.

**Conclusion : M24 validé le 9 octobre 2026. Nouveau layout, migration b8x,
correction des gardes et deux builds consécutifs avec lancement `Ping` validés.
La campagne reste ciblée : les suites applicatives complètes b8x et les autres
ports ne sont pas inclus dans ce relevé.**

### Complément runj — 9 octobre 2026

Le runner externe [altbak.pub-gopurs/bin/java/run](../../../altbak.pub-gopurs/bin/java/run)
attendait encore `java_output/MainRun.java` après une génération réussie.
Checkout initial propre à `323f7c15ab2f5703b5067eec7f4923a449245dd2`.
Le contrôle du launcher et `javac -sourcepath` visent désormais `output/java` ;
la compilation et le packaging partagent `output/java/classes`. La préparation
commune retire déjà tout `output` avant une reconstruction, ce qui remplace le
nettoyage séparé des anciens dossiers. La documentation du benchmark décrit
le layout relatif à chaque workspace et le JAR conservé à sa racine.

Vérifications avec le profil Java existant, OpenJDK 26.0.2 et `-Xss100M` :

- `./bin/java/run --build-only` : **code 0**, mode `pure` et JAR produits dans
  `run/bak/java/modes/pure`, sans exécution de la suite complète.
- `./bin/java/run --test Fib --build-dir "…/Fibonacci workspace"` : génération,
  compilation, packaging et exécution réussis ; oracle **55** validé.
- Même sélection avec `--build-only`, après insertion d'une classe sentinelle :
  **code 0**, bytecode obsolète absent du dossier et du JAR ; anciens chemins
  `java_output` et `classes` non créés dans ce workspace neuf.
- Même sélection avec `--run-only` : **code 0**, manifeste/SHA-256 du JAR et
  oracle **55** validés. Syntaxe Python, documentation et diffs vérifiés.

Preuves :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m24-runj/`
contient `references.json`, `validation.json`, `pure-build.log`,
`fib-{first,rebuild,run-only}.log` et le workspace ciblé.

Le signalement suivant révèle que le dossier affiché avant la commande ne
détermine pas le runner exécuté : `zsh -ic 'whence -v runj altj'` résout `runj`
en `altj; ./bin/java/run -c;`, et `altj` fait un `cd` vers
`altbak.pub-javapurs`. Le premier correctif portait sur la copie Gopurs.
La copie réellement appelée, [altbak.pub-javapurs/bin/java/run](../../../altbak.pub-javapurs/bin/java/run),
encore propre à la même révision `323f7c15…`, est donc corrigée à son tour.

Depuis `altbak.pub-gopurs`, les vérifications passent par le véritable alias
`altj` dans un shell interactif, puis exécutent le runner de sa destination :

- `./bin/java/run -c --build-only` : **code 0**, JAR `pure` produit dans
  `altbak.pub-javapurs/run/bak/java/modes/pure` après nettoyage complet du
  workspace marqué, conformément à l'option de `runj`.
- `./bin/java/run -c --test Fib`, puis `./bin/java/run --test Fib --run-only` :
  **deux codes 0 et oracle 55** ; sources, classes et JAR du checkout Javapurs
  contrôlés, anciens dossiers séparés absents des workspaces reconstruits.

Les définitions des alias, commandes, empreintes des JAR et résultats sont
conservés dans `javapurs-m24-runj/alias/{aliases.txt,validation.json}` et les
trois logs de cette même sous-arborescence. La suite complète du benchmark
n'est pas exécutée ; le contrôle ciblé couvre ici le routage effectif, le
nettoyage `-c`, la génération, le packaging et l'exécution sauvegardée.

## Validation M25

### Périmètre et référence — 19 octobre 2026

La suite Node EventEmitter restait le seul échec FFI observé pendant M23 :
**1/14 tests**, avec treize erreurs `Boolean cannot be cast to Supplier`.
La référence du compilateur est `08c4432b4f2a7db47c6fb2383b8f012999d50ac6` ;
le port est à `ab34c93ee1c70fdc85cf18861588b6f3bb54b034`, avec un checkout
initial propre. La [validation M23](testing.md#validation-m23) conserve son résultat
historique ; M25 corrige le défaut courant et étend la couverture.

### Causes et corrections

| Défaut | Correction |
| --- | --- |
| `unsafeEmitFn` retournait un `Boolean` brut alors que `runEffectFn` attend un effet `Supplier` en Java. | Chaque application d'argument construit un proxy à la fois `Function` et `Supplier` ; le dernier pas exécute `emit` et renvoie un `Effect Boolean`. L'arité variable reste disponible sans `EffectFnN` spécialisé. |
| Le wrapper `once` appelait le listener avec un tableau d'arguments vide. | Le wrapper conserve le listener d'origine et `fire` lui transmet tous les arguments de l'événement. |
| Le callback de désinscription d'un `once` ne retirait pas le wrapper. | `removeListener` retrouve le wrapper par identité de son listener d'origine, en partant de la fin comme Node. |
| Les événements passés étaient rejoués aux listeners ajoutés plus tard. | Le cache `fired`/`lastArgs` est retiré : seuls les listeners présents au moment de `emit` sont appelés. |
| Les exceptions des listeners étaient absorbées. | Elles remontent désormais à l'appelant de `emit`, conformément à Node. |

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `../javapurs-node-event-emitter/bin/test` avant correction | **Code 1, 1/14**, reproduit sur la révision `ab34c93` ; les logs et le workspace en échec sont conservés. |
| Même commande après correction | **Code 0, 19/19 tests** et marqueur unique ; cinq sondes négatives réussies (assertion tardive, rejet, timeout, échec Spec capturé, sortie prématurée). |
| Régressions ajoutées | Retour booléen d'`emit`, arguments multiples, absence de rejeu pour un listener tardif, `once` exécuté une seule fois, propagation d'une exception de listener. |
| `node --test test/test-tools.mjs` | **27/27 tests**, dont la sélection du port et son compte attendu de 19. |
| Sonde Node Streams avec `Test.Main` synchrone | Information seule, **pas une validation M25** : le processus termine sans erreur, mais `testPipe` attache son listener de sortie après l'émission synchrone des données. Cette sonde motive le tampon d'événements de M26. |
| Documentation, syntaxe et diffs | `node tools/check-docs.mjs`, `git diff --check` dans les deux dépôts et inspection des changements réussis. |

Comparaison Java : la FFI est un fragment inséré, non généré par PBO ; aucun
autre fichier Java du backend n'est modifié. Le test du port compile en release
17 avec OpenJDK 26.0.2 et s'exécute sur la même JVM.

Preuves :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m25/`
contient `references.json`, les logs `javapurs-m25-event-{baseline,final}.log`,
les sondes exploratoires `streams-*` et `*-probe.log` qui motivent le maintien
du rejet Node Streams, puis `test-tools.log`.

**Conclusion : M25 validé le 19 octobre 2026. Node EventEmitter passe de 1/14 à
19/19 avec ses cinq sondes. À ce stade, six protocoles de fin restent rejetés ;
M26 traite ensuite Node Streams.**

## Validation M26

### Périmètre et correction — 19 octobre 2026

La sonde M25 montrait que Node Streams ne pouvait pas être déclaré synchrone :
les flux Java émettent `data`, `readable` et `end` immédiatement, alors que le
test attache certains listeners après l'écriture. Le processus sortait sans
erreur, mais des assertions ne s'exécutaient pas. Le rejeu global de
l'EventEmitter avait masqué ce défaut ; il a été retiré en M25.

`Node/Stream.java` ajoute donc un historique borné à **4 096 événements** par
`ReadableStream`. Tout événement de stream y est consigné, puis rejoué au
listener ajouté plus tard. Le mécanisme reste limité aux streams ; l'EventEmitter
général ne rejoue aucun événement. Cette émulation correspond au tampon des flux
Node pour ce backend eager, sans modifier les assertions métier.

`Test.Main` ajoute un test dédié : écriture avant abonnement, puis vérification
que le listener `data` ajouté ensuite reçoit bien le payload. Sans l'historique,
la valeur resterait vide et l'assertion échouerait.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `../javapurs-node-streams/bin/test` | **Code 0**, protocole synchrone, aucune erreur d'assertion. |
| Test de listener tardif ajouté | Écriture, abonnement `data`, rejeu et comparaison du payload réussis. |
| `node --test test/test-tools.mjs` | **27/27 tests**, avec Node Streams sélectionné en synchrone et cinq profils rejetés. |
| Documentation, syntaxes et diffs | `node tools/check-docs.mjs`, `git diff --check` et inspection des changements réussis. |

Preuves :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m25/`
contient `streams-final.log`, `streams-probe.log`, `event-final-m26.log`,
`yoga-probe3.log` (sonde non retenue) et les autres logs du lot.

Une sonde séparée a composé explicitement les quatre modules Spec de Yoga JSON
pour contourner `spec-discovery` : après une correction exploratoire, non
conservée, de l'ordre `JS.BigInt`, elle atteint **44/52 tests**, puis échoue sur des écarts
Null/Undefined et de sérialisation de champs optionnels. Cette piste n'est pas
retenue ; Yoga JSON reste rejeté et demande un traitement sémantique dédié.

**Conclusion : M26 validé le 19 octobre 2026. Node Streams passe en protocole
synchrone ; cinq protocoles restent rejetés (Node FS, HTTP, Net, Spec et Yoga
JSON).**

## Validation M27

### Périmètre et correction — 19 octobre 2026

Node FS restait rejeté pour deux raisons distinctes : `Test.Main` combine des
callbacks synchrones, des streams et un `launchAff_` non attendu. Les streams de
fichier Java étaient également eager et ne terminaient pas toujours avant que
le listener `end` soit ajouté.

Le port expose désormais `TestAff.testAff :: Aff Unit`, tout en conservant
`main = launchAff_ testAff` pour JavaScript. `tests/port-suites/Fs.purs` exécute
`Test.main`, `TestAsync.main`, `Test.Streams.main`, attend `testAff` avec la
frontière `awaitAff` commune, puis publie `[OK] node-fs suite`. Les streams de
fichier positionnent `ended` et émettent `end` via l'historique borné de M26 ;
`Stream.pipe` ajoute ses listeners par `addListener`, ce qui rejoue correctement
la fin au stream de destination.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `../javapurs-node-fs/bin/test` | **Code 0**, wrapper exécuté et marqueur commun présent. |
| Log d'exécution détaillé | `Testing streams`, **`all good`**, liste des répertoires issue de `TestAff`, puis `PORT SUITE COMPLETED` et `[OK] node-fs suite`. |
| `node --test test/test-tools.mjs` | **27/27 tests** avec le wrapper Node FS et quatre profils rejetés. |
| Documentation, syntaxes et diffs | `node tools/check-docs.mjs`, `git diff --check` et inspection des changements réussis. |

Preuves :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m25/`
contient `fs-suite.log`, `fs-suite-probe.log` et son workspace `fs-probe/`
avec `logs/execution.log`.

**Conclusion : M27 validé le 19 octobre 2026. Node FS rejoint les protocoles
validés ; quatre protocoles restent rejetés : Node HTTP, Node Net, Spec et Yoga
JSON.**

## Validation M28

### Périmètre et correction — 19 octobre 2026

Node Net restait rejeté car `Test.Main` rendait la main après l'enregistrement
des callbacks TCP, alors que le serveur et le socket vivent sur des threads JVM.
Le test expose désormais `testNet :: Aff Unit`, qui attend l'événement final de
fermeture du socket. `tests/port-suites/Net.purs` joint cette action avec
`awaitAff`, puis publie `[OK] node-net suite`.

Deux défauts réels ont été corrigés en même temps :

- Les deux listeners `listening` sont enregistrés avant `listenTcp`, car la FFI
  Java émet cet événement de façon eager.
- `addressTcpImpl` renvoyait un `Just record` alors que le contrat `Nullable`
  attend le record brut ou `null`; le cast JVM échouait.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `../javapurs-node-net/bin/test` | **Code 0**, protocole synchrone avec wrapper, marqueur commun présent. |
| Log d'exécution détaillé | `Server is listening`, serveur ouvert, socket connecté/ready, connexion acceptée, deux messages reçus, fin socket, fermeture sans erreur, `PORT SUITE COMPLETED` et `[OK] node-net suite`. |
| `node --test test/test-tools.mjs` | **27/27 tests** avec Node Net sélectionné et trois profils rejetés. |
| Documentation, syntaxes et diffs | `node tools/check-docs.mjs`, `git diff --check` et inspection des changements réussis. |

Preuves :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m25/`
contient `net-suite.log`, `net-suite-probe.log` et son workspace
`net-probe-suite/logs/execution.log`.

**Conclusion : M28 validé le 19 octobre 2026. Node Net rejoint les protocoles
validés ; trois protocoles restent rejetés : Node HTTP, Spec et Yoga JSON.**

## Validation M29

### Périmètre et corrections — 20 octobre 2026

Yoga JSON ne pouvait pas utiliser `spec-discovery` sur JVM (import dynamique
Node indisponible). `Test.Main` exporte maintenant une composition explicite des
quatre Specs ; le wrapper Spec commun l'exécute et vérifie le nombre de succès.

Les huit échecs restants provenaient de trois familles de représentation :

- `Foreign` ne distinguait pas une propriété absente de `null`. Un sentinel
  `Foreign.undefined` partagé est renvoyé par les lectures absentes/hors bornes ;
  `tagOf` le nomme `Undefined` et `Foreign.Index` lit aussi les `Object[]`.
- `Yoga.JSON` sérialisait les `BigInteger` comme nombres et les `undefined`
  comme `null`. Les BigInt sont désormais des chaînes JSON et les propriétés
  `undefined` sont omises des objets ; les tableaux conservent `null`.
- `JSDate` n'implémentait pas `toISOString` et ne parsait pas le séparateur
  `:` utilisé par le test. Formatage ISO avec millisecondes et parsing
  `Instant`/forme historique sont ajoutés.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `../javapurs-yoga-json/bin/test` | **Code 0, 52/52 tests** et cinq sondes négatives. |
| Vérifications croisées après changement de `Foreign` | EventEmitter **19/19**, Node Streams, Node FS, Node Net réussis ; `ffi-ports` **25 contrôles × 2 représentations × classes/JAR**. |
| `node --test test/test-tools.mjs` | **27/27 tests**, Yoga JSON attendu et deux profils rejetés. |
| Documentation, syntaxes et diffs | `node tools/check-docs.mjs`, `git diff --check` et inspection des changements réussis. |

Preuves :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m25/`
contient `yoga-suite.log`, `yoga-probe6.log`, `event-final.log`,
`fs-final.log`, `net-final.log`, `streams-final.log` et `ffi-ports-m29.log`.

**Conclusion : M29 validé le 20 octobre 2026. Yoga JSON rejoint les protocoles
validés ; deux protocoles restent rejetés : Node HTTP et Spec.**

## Validation M30

### Périmètre et correction — 20 octobre 2026

Spec ne peut pas exécuter `runSpecAndExitProcess'` dans le wrapper JVM : il
sortirait du processus et ses tests d'intégration lancent `npx`/`spec-node` via
`node-child-process`, sans port Java. `Test.Main` exporte donc `pureSpec`, la
composition des six modules déterministes ; `tests/port-suites/SpecOnly.purs`
l'exécute avec `evalSpecT`, autorise les trois pending upstream et rejette tout
échec.

Le wrapper vérifie le nombre de succès et applique les cinq sondes communes. Il
ne prétend pas couvrir les tests d'intégration, qui restent explicitement hors
périmètre JVM.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `../javapurs-spec/bin/test` | **Code 0, 62/62 tests**, trois pending upstream, cinq sondes négatives. |
| Composition | `runnerSpec`, `assertionSpec`, `hookSpec`, `hoistSpecSpec`, `parallelSpec`, `teamcitySpec` ; intégration exclue. |
| `node --test test/test-tools.mjs` | **27/27 tests**, Spec attendu et un profil rejeté. |
| Documentation, syntaxes et diffs | `node tools/check-docs.mjs`, `git diff --check` et inspection des changements réussis. |

Preuves :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m25/`
contient `spec-suite.log` et les logs associés.

**Conclusion : M30 validé le 20 octobre 2026 pour le périmètre Spec pur. Un
protocole complet reste rejeté : Node HTTP.**

## Validation M31

### Périmètre et correction — 20 octobre 2026

Node HTTP était le dernier protocole rejeté. Le test combine plusieurs serveurs
HTTP/HTTPS, des requêtes externes et deux upgrades. `Test.Main` expose maintenant
`testHttp :: Aff Unit`, qui exécute les parties synchrones puis joint
`testUpgradeAff` ; le wrapper `Http.purs` attend cette action.

La FFI HTTP a été complétée :

- en-têtes de requête et de réponse normalisés en minuscules, comme Node ;
- événement serveur `upgrade` pour `Connection: upgrade` et `Upgrade` ;
- réponse client 101 conservant le socket sous-jacent (`IM.socket`) sans lire
  de corps ;
- en-tête `Connection: close` ajouté seulement lorsqu'il n'est pas fourni.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `../javapurs-node-http/bin/test` | **Code 0**, suite hermétique, `[OK] node-http suite` et marqueur commun. |
| Log détaillé | Serveurs 8080/8081/3000, **426 Upgrade Required**, **101 Switching Protocols**, socket détruit, `PORT SUITE COMPLETED`. |
| `JAVAPURS_HTTP_EXTERNAL=1` | Les deux requêtes externes optionnelles (`pursuit`, `httpbin`) restent disponibles pour une vérification réseau explicite. |
| `node --test test/test-tools.mjs` | **27/27 tests**, toutes les sélections exécutables, aucune rejetée. |
| Documentation, syntaxes et diffs | `node tools/check-docs.mjs`, `git diff --check` et inspection des changements réussis. |

Les requêtes `pursuit.purescript.org` et `httpbin.org` sont opt-in via
`JAVAPURS_HTTP_EXTERNAL=1` ; le parcours par défaut n'a aucune dépendance
réseau. Cette option couvre une vérification externe explicite.

Preuves :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m25/`
contient `http-suite.log`, `http-suite-probe.log` et
`http-probe-suite/logs/execution.log`.

**Conclusion : M31 validé le 20 octobre 2026. Toutes les sélections exécutables
ont une action de fin ; l'intégration Spec est couverte par M32.**

## Validation M32

### Intégration Spec via `node-child-process` — 20 octobre 2026

Le wrapper `SpecFull` compose `pureSpec` et les huit cas de
`integration-tests/cases`, puis exécute le tout avec `evalSpecT`. Le harnais
utilise le `spago` local au lieu de `npm install`/`npx` ; il ne dépend donc plus
d'un environnement npm temporaire.

Le port Java `javapurs-node-child-process` fournit `spawn`/`spawn'`, stdout,
stderr, `exit`, `close` et `error`. Trois corrections ont été nécessaires :

- rejouer les événements `exit`/`close` aux listeners attachés après la sortie,
  avec un historique borné ;
- rediriger stdin vers `/dev/null` pour les enfants Node qui terminent via la
  boucle d'événements ;
- borner chaque sous-processus à 60 s, avec une reprise du cas si la sortie
  nettoyée est vide.

`Node.FS.Async` accepte désormais les callbacks Node `(error, value)` et les
callbacks unaires (`access`), sans modifier les assertions upstream.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `../javapurs-spec/bin/test` | **Code 0**, `spec: 70 checks completed` : **62 Spec purs + 8 intégrations**. |
| Cas d'intégration | `01-all-passing`, `02-all-failing`, `03-some-passing`, `04-fail-fast-with-timeout`, `05-fail-fast-due-to-test-failure`, `issue-144`, `issue-149`, `issue-157` ; golden outputs comparés. |
| Sondes | Cinq sondes négatives du wrapper réussies (`late-failure`, `rejection`, `timeout`, `spec-failure`, `early-exit`). |
| `node test/child-process.mjs` | Réussi : spawn, stdout `child-ok`, code 0 et rejeu du listener `exit` tardif. |
| `node --test test/test-tools.mjs` | **27/27 tests**. |
| Documentation, syntaxes et diffs | `node tools/check-docs.mjs`, `git diff --check` et inspection des changements réussis. |

Le garde Java de la suite est porté à `-Djavapurs.test.timeout=600000` pour
laisser les huit cas et leurs reprises s'exécuter. La sortie de chaque cas reste
comparée telle quelle aux fichiers `output.txt`.

Preuves :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m25/`
contient `spec-final-clean.log`, `spec-full-retry3.log` et
`spec-case04.log`.

**Conclusion : M32 validé le 20 octobre 2026. Spec complet passe 70/70 ; aucun
protocole du runner n'est rejeté.**

