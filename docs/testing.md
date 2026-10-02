# Tests ciblés et registre de validation

État documenté au **2 octobre 2026**. Les commandes de cette page s'exécutent
depuis le dépôt du compilateur `htdocs/javapurs/javapurs`, sauf indication contraire.

## Choisir le bon niveau

| Niveau | Entrée et résultat vérifié |
| --- | --- |
| Suites directes `test/*.mjs` | Modules JavaScript construits du compilateur, AST synthétiques et, suivant le script, compilation/exécution de fixtures Java. |
| Pilote `test/driver.mjs` | Application PureScript minimale, TAST réel, launcher `bin/javapurs`, Java généré, JVM et erreurs d'I/O. |
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
  bytecode cible. Cette option est utilisée par b8x, `test/driver.mjs` et `test/chunk.mjs` ;
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
| Preuves de type, stockage et conventions FFI | [test/representations.mjs](../test/representations.mjs) | 43 contrôles JVM sur chacune des huit combinaisons Int/générique, records typés/Maps et appels directs on/off ; même module, champs d'ADT, instantiation/dictionnaires, flèches résiduelles et callbacks dans les records ; `javac --release 17`. |
| AST, `Rename`, `ControlFlow`, `Raw` | [test/ast-scopes.mjs](../test/ast-scopes.mjs) | Masquage, branches sœurs, récursion, métadonnées/sélecteurs, cibles de boucle imbriquées et Java brut ; 110 contrôles JVM par mode, avec/sans chunking. |
| Contextes et traduction `CodeGen.Expr` | [test/codegen.mjs](../test/codegen.mjs) | 48 contrôles JVM par mode, avec/sans chunking : gardes, arguments, effets différés, binds, écritures uniques/identité ST, exceptions, récursion locale et captures échappées. |
| Rendu, corps, littéraux et templates intégrés | [test/printer.mjs](../test/printer.mjs) | 86 contrôles JVM : méthodes/closures/thunks, boucles directes/différées, builtins, chaînes et labels UTF-16, messages et cibles échappés ; `javac --release 17`. |
| TCO, captures d'itération, rendu du contrôle | [test/tco.mjs](../test/tco.mjs) | Boucles, cibles, closures et exécution Java. |
| Boucles comptées | [test/counted-loops.mjs](../test/counted-loops.mjs) | Reconnaissance et génération des boucles, replis et résultats Java. |
| Nommage, constructeurs nullaires, initialisation | [test/nullary-constructors.mjs](../test/nullary-constructors.mjs) | Singletons, portées, noms des modules/constructeurs et initialisations. |
| Records, types de champs et interopérabilité Map | [test/typed-records.mjs](../test/typed-records.mjs) | Construction, lectures, mises à jour et ABI ; le script accepte aussi `--records=maps`. |
| Invariants de boucle et preuve de pureté | [test/loop-invariants.mjs](../test/loop-invariants.mjs) | Évaluation différée, caches par invocation, ordre des effets et candidats refusés. |
| Workers directs, arité et ordre d'initialisation | [test/direct-calls.mjs](../test/direct-calls.mjs) | Saturation, partielles, surapplication, eager/lazy et frontières d'exception. |
| Fonctions Int et ABI publique | [test/int-functions.mjs](../test/int-functions.mjs) | Appels primitifs/génériques, captures et comportement d'évaluation. |
| Opérateurs numériques | [test/operators.mjs](../test/operators.mjs) | Division/modulo Int et égalité Number confrontés aux références sémantiques. |
| Réutilisation des constructeurs | [test/constructor-reuse.mjs](../test/constructor-reuse.mjs) | Réécriture AST et exécution des cas de partage. |
| Ownership et workers consommateurs | [test/ownership.mjs](../test/ownership.mjs) | Sélection, fraîcheur, cas polymorphes/locaux, génération et exécution. |
| `Chunk`, `Chunk.Captures`, `Chunk.Extraction` | [test/chunk.mjs](../test/chunk.mjs) | 15 fixtures : captures imbriquées, portées, types Java, récursion, mutations, ordre des effets, scopes profonds, boucles et frontières 256/257 unités, 64/65 captures. |
| Configuration, pilote, pipeline, FFI et émission | [test/driver.mjs](../test/driver.mjs) | 13 variantes CLI, deux ABI de launcher, entrée vide et six erreurs d'I/O ; TAST-capable `purs`, backend construit et JDK. Modes de comparaison sur entrées figées. |
| Grand arbre de branches | [test/big-function.mjs](../test/big-function.mjs) | Prépare et exécute BigFunction dans un workspace temporaire isolé, puis réalise 155 contrôles de `f`. |
| Sélection, JDK, workspaces, processus | [test/test-tools.mjs](../test/test-tools.mjs) | 11 tests Node : noms et bornes invalides, absence d'effets de `--list`, préparation/FFI, erreurs par phase, logs, temporaires, timeout et signaux aux descendants. |

Pour une modification de `JavaAst` ou de `Printer`, choisir les lignes qui
utilisent les nœuds modifiés et vérifier leurs parcours dans les passes
consommatrices. Pour `Main`, la CLI ou l'insertion FFI, utiliser `driver.mjs`,
éventuellement complété par une fixture nommée pertinente ; les scripts AST seuls
ne couvrent pas l'orchestration. Les fixtures CLI simulées de `test-tools.mjs`
couvrent le runner, celles de `driver.mjs` le compilateur réel.

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

### Pilote de compilation

Pour une modification de la CLI, de l'orchestration, de la FFI ou des sorties :

```bash
./bin/build
node test/driver.mjs
```

Le script prépare quatre modules n'utilisant que `Prim`, puis appelle le `purs`
TAST du PATH avec `--codegen corefn`. Il n'a pas besoin des ports ni d'un workspace
Spago applicatif. Le backend doit être construit ; le JDK est choisi par le
résolveur commun. Les compilations Java utilisent `--release 17`.

Les 13 variantes exercent les six options de désactivation seules et combinées,
le choix de `--main`, sa première occurrence, sa valeur manquante, un module
absent et un argument inconnu. Les douze cas avec launcher sont exécutés sur la
JVM : ABI `Supplier` pour `Main`, ABI `Function` pour `Chosen`. Les assertions
contrôlent aussi records, closures Int, chunks, fragments FFI fournis/vides/absents
et échappement d'un nom étranger réservé en Java.

Une entrée vide vérifie l'inventaire des helpers. Six scénarios d'I/O vérifient
le code de sortie 1, le contexte et la phase marquée `(failed)` : dossier d'entrée
absent, dossier de sortie absent, lecture FFI impossible, écritures de module,
de launcher et de runtime impossibles. Les entrées sont restaurées après ces
scénarios. Le workspace temporaire est supprimé au succès et conservé à l'échec.

Pour comparer les sources Java lors d'un refactoring :

```bash
# Avec la version de référence du backend déjà construite :
BASELINE="$(mktemp -d)/driver"
node test/driver.mjs --record "$BASELINE"

# Après modification et reconstruction du backend :
./bin/build
node test/driver.mjs --compare "$BASELINE"
```

`--record` exige un chemin inexistant, y prépare les entrées et conserve les
sorties par variante sous `expected/`. `inputs.json` enregistre les SHA-256 des
sources PureScript, FFI et TAST. `--compare` réutilise ces entrées sans relancer
`purs`, vérifie leurs empreintes, puis compare inventaire et contenu exact de
chaque fichier Java. Ces deux modes gardent leur répertoire et leurs logs même
au succès. Employer les mêmes versions d'outils et le même environnement entre
les deux runs. L'enregistrement accepte les anciens diagnostics ; la comparaison
et le mode normal contrôlent les diagnostics contextualisés du pilote actuel.

### Chunker et BigFunction

Le [guide du chunker](chunking.md) relie les décisions de capture, coût,
signature et construction des helpers à leurs points d'entrée.

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

### AST, portées et contrôle

Pour les [contrats de l'IR](ast.md), choisir les suites de portée et de contrôle :

```bash
./bin/build
node test/ast-scopes.mjs
node test/tco.mjs
node test/chunk.mjs
```

`ast-scopes.mjs` construit les mêmes AST sous deux variantes : `Rename`, puis
`Rename` → `Chunk`. Les deux variantes passent par `javac --release 17` et la
JVM ; le backend construit et le JDK commun suffisent. Les assertions Node
vérifient aussi les frontières des parcours, l'identité des métadonnées, la
distinction lecture de champ/sélecteur et les formes brutes admises.

Les cas exécutés couvrent les initialiseurs non récursifs masquant un paramètre,
les branches sœurs, les mutations locales, la récursion mutuelle, les lectures
brutes entourées de chaînes/commentaires/membres et les cibles masquées par une
valeur. Un saut traverse une closure puis une boucle interne pour rejoindre
l'externe. Les divisions/modulos structurés sont testés avec captures, extraction,
évaluation unique gauche → droite, diviseur nul et exception du premier opérande.

Compléter avec les suites spécialisées de la matrice quand leur nœud ou leur
analyse change. `operators.mjs` compare notamment 202 cas numériques à leurs
références sémantiques ; `loop-invariants.mjs` couvre le scope des caches différés.

### Traduction des expressions

Pour les [contextes, priorités et frontières d'évaluation](expressions.md) :

```bash
./bin/build
node test/codegen.mjs
node test/int-functions.mjs
node test/direct-calls.mjs
node test/loop-invariants.mjs
```

`codegen.mjs` entre par `Pipeline.lowerModule` avec des fixtures BackendSyntax,
puis compile et exécute le Java avec et sans chunking. Les traces vérifient
l'ordre et le nombre d'exécutions, ainsi que les exceptions et l'identité des
objets retournés par les écritures ST. Les autres suites couvrent notamment les
replis génériques/primitifs, gardes d'initialisation et caches de boucle.
Compléter par les lignes de la matrice correspondant aux workers modifiés.

### Rendu Java

Pour les [plans de corps et frontières Supplier](printing.md) :

```bash
./bin/build
node test/printer.mjs
node test/tco.mjs
node test/counted-loops.mjs
node test/typed-records.mjs
```

La suite `printer.mjs` rend directement des AST. Ses chaînes attendues sont
construites par codes UTF-16 dans Java pour vérifier l'échappement indépendamment
du printer. Elle distingue création et forçage des thunks, y compris une boucle
réexécutée à chaque forçage. Les autres suites couvrent sauts, paramètres et
représentations. Choisir aussi les suites de déclarations/scopes concernées dans
la matrice ; un changement de frontière de méthode appelle notamment les tests
de chunking et de captures.

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
