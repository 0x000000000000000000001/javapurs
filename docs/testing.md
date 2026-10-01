# Tests ciblés et registre de validation

État documenté au **1er octobre 2026**. Les commandes de cette page s'exécutent
depuis le dépôt du compilateur `htdocs/javapurs/javapurs`, sauf indication contraire.

## Choisir le bon niveau

| Niveau | Entrée et résultat vérifié |
| --- | --- |
| Suites directes `test/*.mjs` | Modules JavaScript construits du compilateur, AST synthétiques et, suivant le script, compilation/exécution de fixtures Java. |
| Outillage `test/test-tools.mjs` | Petit corpus et commandes simulés ; sélection, fichiers, processus et interruption. Node suffit. |
| Fixture PureScript nommée | `bin/test NOM` réalise Spago → Javapurs → `javac` → `MainRun` dans `tests/runner`. |
| Port Java particulier | Son propre `bin/test` prépare le workspace du port et exécute son `Test.Main`. |
| Documentation/outillage | Contrôle des chemins, options, sélections, syntaxe des exemples et contrats des sous-processus effectivement modifiés. |

La règle du [chantier de maintenabilité](../../todo.md) est une **validation
ciblée sur les changements** : build du composant modifié et contrôles de ses
responsabilités. `t -c`, le corpus entier et `modtest` sont hors de ce protocole.

Les suites directes n'entrent pas toutes par `Main` : plusieurs appellent une
passe ou `CodeGen` directement. Consulter leur entrée avant de les utiliser
comme preuve d'une interaction entre traduction, renommage, chunking et émission.

## Outils et versions Java

Inventaire local relevé pour M01, le 1er octobre 2026 :

| Outil | Version observée |
| --- | --- |
| Node.js | `24.8.0` |
| Spago | `1.0.3` |
| `purs` sélectionné sur le PATH | `0.15.16 [development build; commit: 3c8fcfd7a3d440bba487fe9fe059284cffc6e908 DIRTY]` |
| `javac` | `26.0.2` |
| `java` | OpenJDK Homebrew `26.0.2`, build `26.0.2` |

Le chemin du binaire `purs` relevé est `~/.local/bin/purs` ; son étiquette de
construction et la révision du checkout du fork sont enregistrées séparément.
Pour relever ces versions, exécuter chaque outil avec `--version`.

### Build JDK, cible et JVM

- **Build du backend :** Spago produit le JavaScript exécuté par Node.
- **Compilation Java :** `javac --release 17` fixe le langage, les API et le
  bytecode cible. Cette option est utilisée par b8x et `test/chunk.mjs` ;
  `test/big-function.mjs` l'applique à son harness supplémentaire.
- **Runner de fixtures :** `bin/test` appelle actuellement `javac` sans
  `--release`. Les classes de `BigFunction` produites par ce runner suivent donc
  son JDK, même si le harness ajouté ensuite cible Java 17.
- **Exécution :** la JVM doit accepter le bytecode produit. Les régressions
  locales de référence ont utilisé le JDK 26.0.2 pour compiler et exécuter.
  L'inventaire ne constitue pas une matrice exhaustive des versions supportées.

Après avoir sélectionné un même JDK sur le PATH :

```bash
export JAVAC="$(command -v javac)"
export JAVA="$(command -v java)"
```

[tools/java-tools.mjs](../tools/java-tools.mjs) fournit le choix commun aux
suites Java et aux runners :

1. `JAVAC`/`JAVA` explicites ; si un seul est fourni, prendre l'autre exécutable
   dans le même dossier réel, après résolution des liens symboliques.
2. Sinon, le dossier `bin/` de `JAVA_HOME`.
3. Sinon, `javac` sur le PATH et son voisin `java`, avec un dernier repli
   vers `/opt/homebrew/opt/openjdk/bin/javac`.

Un exécutable absent ou deux dossiers JDK différents produisent une erreur.
Le support d'agrégation des ports transmet aussi le dossier du JDK sur le PATH,
pour les scripts qui appellent directement `javac` et `java`. Appelés seuls,
les scripts Aff/Refs conservent leur sélection sur le PATH.

`JAVAPURS_HEAP` règle le heap Node du compilateur. Les options de heap Java,
comme `JAVA_TOOL_OPTIONS=-Xmx4g`, concernent les processus JVM. La cible
`--release 17` ne règle ni l'un ni l'autre.

## Matrice des tests

Reconstruire avec `./bin/build` après un changement des sources du compilateur
ou de sa dépendance PBO, puis sélectionner les scripts concernés ci-dessous.
Chaque chemin de script s'utilise avec `node`, depuis la racine du dépôt.

| Responsabilité touchée | Suite disponible | Contrats couverts / prérequis particuliers |
| --- | --- | --- |
| `IntLoops` | [test/int-loops.mjs](../test/int-loops.mjs) | Classification des paramètres primitifs, types polymorphes et `TypeApp` ; chemin synthétique Node sans `javac`. |
| TCO, captures d'itération, contrôle dans `Printer` | [test/tco.mjs](../test/tco.mjs) | Boucles, cibles, closures et exécution Java. |
| Boucles comptées | [test/counted-loops.mjs](../test/counted-loops.mjs) | Reconnaissance et génération des boucles, replis et résultats Java. |
| Nommage, constructeurs nullaires, initialisation | [test/nullary-constructors.mjs](../test/nullary-constructors.mjs) | Singletons, portées, noms des modules/constructeurs et initialisations. |
| Records, types de champs et interopérabilité Map | [test/typed-records.mjs](../test/typed-records.mjs) | Construction, lectures, mises à jour et ABI ; le script accepte aussi `--records=maps`. |
| Invariants de boucle et preuve de pureté | [test/loop-invariants.mjs](../test/loop-invariants.mjs) | Évaluation différée, caches par invocation, ordre des effets et candidats refusés. |
| Workers directs, arité et ordre d'initialisation | [test/direct-calls.mjs](../test/direct-calls.mjs) | Saturation, partielles, surapplication, eager/lazy et frontières d'exception. |
| Fonctions Int et ABI publique | [test/int-functions.mjs](../test/int-functions.mjs) | Appels primitifs/génériques, captures et comportement d'évaluation. |
| Opérateurs numériques | [test/operators.mjs](../test/operators.mjs) | Division/modulo Int et égalité Number confrontés aux références sémantiques. |
| Réutilisation des constructeurs | [test/constructor-reuse.mjs](../test/constructor-reuse.mjs) | Réécriture AST et exécution des cas de partage. |
| Ownership et workers consommateurs | [test/ownership.mjs](../test/ownership.mjs) | Sélection, fraîcheur, cas polymorphes/locaux, génération et exécution. |
| Renommage et chunking | [test/chunk.mjs](../test/chunk.mjs) | 11 fixtures : captures imbriquées, portées, types Java, récursion, mutations, ordre des effets, scopes profonds et boucles. |
| Grand arbre de branches | [test/big-function.mjs](../test/big-function.mjs) | Prépare et exécute BigFunction dans un workspace temporaire isolé, puis réalise 155 contrôles de `f`. |
| Sélection, JDK, workspaces, processus | [test/test-tools.mjs](../test/test-tools.mjs) | 11 tests Node : noms et bornes invalides, absence d'effets de `--list`, préparation/FFI, erreurs par phase, logs, temporaires, timeout et signaux aux descendants. |

Pour une modification de `JavaAst` ou de `Printer`, choisir les lignes qui
utilisent les nœuds modifiés et vérifier leurs parcours dans les passes
consommatrices. Pour `Main`, la CLI ou l'insertion FFI, préparer une fixture
nommée qui emprunte le chemin complet ; les scripts AST seuls ne couvrent pas
l'orchestration. Les fixtures CLI simulées de M02 couvrent le runner ; les
fixtures du pilote de compilation relèvent de M03.

### Entrées optionnelles de benchmarks

Ces options étendent certaines suites à un projet déjà construit :

| Script | Option | Cache examiné notamment |
| --- | --- | --- |
| `int-loops.mjs` | `--polymorphism-project CHEMIN` | `Test.Polymorphism`, `Test.RBTree`. |
| `loop-invariants.mjs` | `--lazy-project CHEMIN` | Projet du cas LazyEvaluation. |
| `direct-calls.mjs` | `--rbtree-project CHEMIN` | `Test.RBTree`. |
| `int-functions.mjs` | `--church-project CHEMIN` | Projet du cas Church. |
| `typed-records.mjs` | `--records-project CHEMIN` | Projet du cas Records. |

Les commentaires de chaque script décrivent le layout attendu. Ces options
lisent les caches du projet ; elles ne déclenchent pas sa préparation complète.

## Fixtures PureScript nommées

[bin/test](../bin/test) délègue à [passing-runner](../tools/passing-runner.mjs).
La sélection lit en priorité le corpus du fork à
`../../purescript/tests/purs/passing`, avec un repli vers `tests/passing`.
Les ports nécessaires sont définis dans
[tests/runner/spago.yaml](../tests/runner/spago.yaml), également utilisé comme
template des workspaces isolés.

```bash
./bin/test BigFunction DerivingTraversable --list
./bin/test DerivingTraversable
```

Le premier appel doit lister exactement les deux noms. Le second exécute une
seule fixture. Le runner accepte nom, nom avec `.purs` ou chemin de fichier.
Un nom, une option ou une borne introuvable fait échouer toute la sélection avec
le code 2, avant tout build ou nettoyage. Une demande explicite de fixture exclue
échoue aussi. `--list` résout seulement la sélection, même avec `-c` ; aucun JDK
ni package Java n'est requis pour cette liste. Les noms sans chemin sont aussi
cherchés dans `tests/passing`. L'absence de noms conserve la sélection par défaut
du corpus ; les recettes de ce chantier utilisent des noms explicites.

Pour chaque fixture sélectionnée :

1. Une surcharge locale de même nom dans `tests/passing` prime sur le fichier du
   fork. Les modules auxiliaires du dossier associé sont copiés avec elle.
2. Le runner remplace `tests/runner/src`, `output`, `java_output` et `classes`.
3. Une FFI Java adjacente prime sur `tests/ffi/NOM.java` ; la FFI JavaScript
   adjacente, lorsqu'elle existe, satisfait la compilation PureScript.
4. Il appelle Spago, Javapurs, `javac`, puis `java -cp classes MainRun`.
5. Il conserve `purescript.log`, `generation.log`, `javac.log` et `execution.log`
   dans `logs/tests/NOM/`. Le dossier de logs de cette fixture est remplacé au
   début de son prochain run ; une phase non atteinte n'a donc pas de vieux log.
   Les échecs indiquent nom, phase, code de sortie/signal et chemin du log.

`--keep-going` poursuit les noms sélectionnés après un échec. Une interruption
arrête le run, y compris dans ce mode, avec le code 130 pour SIGINT ou 143 pour
SIGTERM. Les bornes inclusives `skip_before=` et `until=` s'appliquent à la
sélection ; les formes `--skip-before NOM` et `--until NOM` sont aussi acceptées.
`-c` reconstruit le backend, puis nettoie `.spago` et `.purmeta` du runner.
Les exclusions actuelles sont `DerivingClause`,
`DerivingContravariant`, `DerivingFunctorFromBi`, `DerivingFunctorFromPro`,
`DerivingProfunctor` et `4179` : fonctionnalités rejetées par le frontend partagé
ou sémantique JavaScript spécifique.

### Chunker et BigFunction

Séquence ciblée pour un changement des captures, scopes ou budgets :

```bash
./bin/build
node test/chunk.mjs
node test/big-function.mjs
./bin/test DerivingTraversable
```

Vérifier le succès de chaque commande avant la suivante. BigFunction sélectionne
la fixture du fork (ou sa surcharge locale), copie le template Spago avec les
chemins des ports rendus absolus, puis déroule les quatre phases et le harness.
Le compilateur doit être construit et les ports du template disponibles.
Le script retrouve le dépôt depuis sa propre URL et fonctionne depuis un autre
dossier courant. Il utilise `javac -J-Xmx4g` et une JVM de contrôle à `-Xmx512m`.

Les workspaces temporaires utilisent `TMPDIR` ou le dossier temporaire de l'OS.
Ils sont supprimés au succès, conservés avec un chemin explicite en cas d'échec.
Les logs du pipeline BigFunction sont dans `logs/BigFunction/` du workspace, ceux
du harness dans `checks/`. `tests/runner` reste disponible pour une autre fixture.

L'allocation d'entrée du harness est bornée : les 51 tailles de motifs sont
exercées, 26 avec succès de toutes les gardes et les grandes tailles par leurs
chemins d'échec. Ce contrôle complète le `main` du corpus, qui couvre peu `f`.

### Outillage des tests

```bash
node --test test/test-tools.mjs
```

Cette suite crée un petit dépôt temporaire et des exécutables simulés. Elle
exerce réellement le launcher et ses phases, puis les erreurs de lancement,
codes non nuls, timeout avec arrêt forcé et transmission des signaux aux
petits-enfants. Elle vérifie aussi le nettoyage au succès et la conservation
des fichiers en échec.

| Module partagé | Responsabilité |
| --- | --- |
| [test-selection](../tools/test-selection.mjs) | Options et résolution complète de la sélection avant les opérations de fichiers. |
| [fixture-runner](../tools/fixture-runner.mjs) | Template Spago, préparation de la fixture/FFI et phases jusqu'à la JVM. |
| [java-tools](../tools/java-tools.mjs) | Paire cohérente `javac`/`java` et environnement des ports. |
| [test-workspace](../tools/test-workspace.mjs) | Cycle de vie des répertoires temporaires. |
| [test-process](../tools/test-process.mjs) | Commandes synchrones des suites AST et processus asynchrones des runners. |

Les commandes synchrones conservent les choix de stdio et de timeout de chaque
suite. Les runners asynchrones isolent chaque phase dans un groupe de processus,
transmettent SIGINT/SIGTERM, puis forcent l'arrêt après une seconde si nécessaire.
Le stdout capturé est distinct du stderr, tandis que le log contient les deux.

### Port particulier

Choisir le script du port touché, par exemple :

```bash
../javapurs-refs/bin/test
```

Le script se place dans son propre dépôt. Les runners Aff/Refs reconstruisent
leurs sorties et peuvent sélectionner `spago.java.yaml` via le lien `spago.yaml`.
Ils utilisent le compilateur frère puis exécutent `Test.Main` sur la JVM avec
`-Xss8m`. Consulter le script du port pour ses prérequis ; le runner agrégé
`tools/modtest-runner.mjs` est un autre niveau d'orchestration.

## Consigner une validation

Pour le lot traité, conserver :

- référence des sources et état du checkout ; versions des outils et variables
  d'environnement qui influencent le build ou l'exécution ;
- responsabilité et fichiers modifiés, commandes ciblées, résultat et code de sortie ;
- pour la génération, mêmes TAST/options/FFI et comparaison des contenus et de
  l'inventaire Java pertinents ;
- pour une mesure, phase chronométrée et paramètres JVM, séparément des contrôles
  fonctionnels ; les durées de `Metrics` excluent `purs`, `javac` et l'application ;
- emplacement des preuves utiles, conclusion et état du lot dans le plan.

## Références acquises avant M01

Ces résultats proviennent de la mise au point précédente de la chaîne Java :

| Périmètre | Résultat acquis |
| --- | --- |
| Reconstruction du backend après correction du chunker | Réussie. |
| `BigFunction` | 1/0 ; chaîne complète en 23,9 s, heap Java plafonné à 4 Go. |
| Harness `big-function.mjs` | 155 contrôles réussis, avec les limites d'entrée décrites ci-dessus. |
| `DerivingTraversable` | 1/0. |
| `chunk.mjs` | 11 fixtures réussies. |
| b8x Java, validation d'intégration antérieure à la correction du chunker | Build réussi et 286/286 tests ; ce relevé décrit cette campagne applicative antérieure. |

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
