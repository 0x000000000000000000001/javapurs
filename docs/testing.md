# Tests ciblés et registre de validation

État documenté au **5 octobre 2026**. Les commandes de cette page s'exécutent
depuis le dépôt du compilateur `htdocs/javapurs/javapurs`, sauf indication contraire.

## Choisir le bon niveau

| Niveau | Entrée et résultat vérifié |
| --- | --- |
| Suites directes `test/*.mjs` | Modules JavaScript construits du compilateur, AST synthétiques et, suivant le script, compilation/exécution de fixtures Java. |
| Pilote `test/driver.mjs` | Application PureScript minimale, TAST réel, launcher `bin/javapurs`, Java généré, JVM et erreurs d'I/O. |
| Entrée `test/input.mjs` | TAST réels puis altérés, refus avant préparation Java, conservation de l'ancienne génération et des caches ; frontend TAST et backend construit. |
| Entrée JVM `test/entrypoint.mjs` | Dix modules principaux réels : appel des deux ABI, refus des valeurs non exécutables et propagation des erreurs, en classes et JAR autonomes. |
| Sorties `test/output-files.mjs` | Transactions filesystem réelles : inventaire, conflits, retour arrière et récupération après `SIGKILL`. Node suffit. |
| Outillage `test/test-tools.mjs` | Petit corpus et commandes simulés ; sélection, fichiers, processus et interruption. Node suffit. |
| Installation source | `test/source-install.mjs` vérifie les frontières de build/installateur ; `tools/install-source.mjs` reconstruit le fork et le backend puis exécute Hello/Refs en classes et JAR dans un workspace neuf. |
| Fixture PureScript nommée | `bin/test NOM` réalise Spago → Javapurs → `javac` → `MainRun` dans `tests/runner`. |
| Protocoles des ports Java | `test/ffi-runtimes.mjs` compile les vrais fragments ; `test/ffi-ports.mjs` attend l'intégration PureScript réelle dans deux modes de records. Les quatre ports proposent `bin/test-runtime`. |
| Suite d'un port | Les `bin/test` Aff/Promise/Promise-Aff délèguent à `test/port-runners.mjs` : workspace isolé, suite attendue et sondes d'échec. Les autres ports gardent leur runner propre. |
| Documentation/outillage | `tools/check-docs.mjs` contrôle liens/ancres, exemples shell, matrice/options et score ; les suites d'outillage vérifient les contrats des processus modifiés. |

La règle du [plan de travail actif](../../todo.md) est une **validation
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

M15 ajoute un `purs` **reconstruit depuis le fork épinglé**, dont la version annonce
`b4a7fb1ca78eeb10b847558af0fcbeab06fa5c16` sans marqueur `DIRTY`. La référence
historique ci-dessus et ce nouveau binaire sont distincts ; voir les chemins,
GHC et empreintes dans la [validation M15](#validation-m15).

### Build JDK, cible et JVM

- **Build du backend :** Spago produit le JavaScript exécuté par Node.
- **Compilation Java :** `javac --release N` fixe le langage, les API et le
  bytecode cible. `JAVAPURS_JAVA_RELEASE` sélectionne **17 par défaut** dans le
  résolveur commun ; la valeur doit être un entier décimal sans zéro initial,
  au moins 17 et pas supérieur à la version majeure de `javac`.
- **Périmètre commun :** toutes les compilations des suites Node `test/*.mjs`,
  `fixture-runner`/`bin/test`, `port-test-runner` (Aff/Promise/Promise-Aff) et les
  exemples de l'installation source. BigFunction et son harness ont la même cible.
  Les mentions Java 17 dans les recettes courantes désignent ce défaut ; les
  registres datés conservent leurs options réellement exécutées.
- **Exécution :** `JAVAPURS_JAVA_RUNTIME` sélectionne un exécutable `java` distinct
  si nécessaire ; sinon, le runtime voisin de `javac` est utilisé. La cible doit
  être au plus la version majeure de cette JVM. Compiler en release 17 et exécuter
  sur JVM 26 ne remplace pas une exécution sur JVM 17.

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

Un exécutable absent, une version illisible, deux dossiers différents dans la
paire de build, une cible invalide ou supérieure au compilateur/runtime produisent
une erreur. La JVM croisée passe par `JAVAPURS_JAVA_RUNTIME`, pas par une paire
`JAVAC`/`JAVA` dépareillée. Les enfants gardent cette paire de build et l'override
séparé ; le dossier du JDK de build reste sur `PATH`. Les anciens scripts de ports
qui appellent directement `javac`/`java` ne lisent pas les variables `JAVAPURS_*`.
Les launchers Node Aff/Promise/Promise-Aff et les quatre `test-runtime` les prennent
en compte par leurs suites déléguées.

`javaCompileArgs` rejette les options concurrentes `--release`, `--source`/
`-source`, `--target`/`-target` et `--enable-preview` du paramètre de fixture avant
son nettoyage. Les options de heap, comme `-J-Xmx4g` de BigFunction, restent admises.

`JAVAPURS_HEAP` règle le heap Node du compilateur. Les options de heap Java,
comme `JAVA_TOOL_OPTIONS=-Xmx4g`, concernent les processus JVM. La cible
`--release 17` ne règle ni l'un ni l'autre.

Pour relever ou exercer une configuration précise, définir les deux chemins de
JDK puis lancer depuis le dépôt :

```bash
unset JAVAC JAVA
export JAVA_HOME="$JDK_RECENT_HOME"
export JAVAPURS_JAVA_RELEASE=17
export JAVAPURS_JAVA_RUNTIME="$JDK17_HOME/bin/java"
node tools/java-tools.mjs
node test/chunk.mjs
```

[tools/check-jdk.mjs](../tools/check-jdk.mjs) fixe une petite sélection de six
suites : pilote, représentations, chunker, BigFunction, protocoles des runtimes
et intégration FFI. Il impose release 17 et exécute les trois configurations
JDK17/JVM17, JDKrécent/JVMrécente et JDKrécent/JVM17. Un petit programme témoin
vérifie la version majeure **61** de la classe et la version réelle de la JVM.
Les suites compilent ensuite leurs propres fixtures neuves avec les mêmes outils.

```bash
node tools/check-jdk.mjs --jdk17 "$JDK17_HOME" \
  --recent-jdk "$JDK_RECENT_HOME" --output "$PWD/jdk-results"
```

La destination doit être absente. `matrix.json` conserve la sélection, les chemins,
versions et résultats ; les logs sont séparés par configuration/suite. Les
processus sont bornés à dix minutes par suite. Les workspaces des suites suivent
leur politique habituelle de conservation à l'échec.

La [validation M16](#validation-m16) a exécuté ces trois lignes avec **Temurin
17.0.20.1+1** et **Homebrew OpenJDK 26.0.2**, sur macOS arm64. Le
[README](../README.md#java-target-and-runtime) en donne la matrice synthétique.

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
| Admission ownership, alias, cellules et littéraux | [test/ownership-admission.mjs](../test/ownership-admission.mjs) | 11 admissions/refus, 28 contrôles JVM en mode persistant et 31 avec ownership : snapshots, identité des cellules, Char/String et nombres IEEE ; `--simple-scalars` isole le cas Char sans erreur d'échappement. |
| Cibles des boucles ownership | [test/ownership-loops.mjs](../test/ownership-loops.mjs) | 9 contrôles JVM par mode : alias arbre/scalaire et scope récursif, 0/1/100 000 itérations avec `-Xss256k`. |
| `Chunk`, `Chunk.Captures`, `Chunk.Extraction` | [test/chunk.mjs](../test/chunk.mjs) | 15 fixtures : captures imbriquées, portées, types Java, récursion, mutations, ordre des effets, scopes profonds, boucles et frontières 256/257 unités, 64/65 captures. |
| Configuration, pilote, pipeline, FFI et émission | [test/driver.mjs](../test/driver.mjs) | 11 variantes CLI, aide, 25 échecs attendus, deux ABI de launcher, bibliothèque/entrée vide, générations successives et deux builds Spago réels ; `purs` TAST, Spago, backend construit et JDK. Comparaison du Java sur entrées figées. |
| Entrée TAST stricte et graphe des imports | [test/input.mjs](../test/input.mjs) | Erreurs filesystem/JSON/décodage/métadonnées, doublons et imports manquants ; sorties/caches préservés, destination neuve absente, lecture séquentielle/parallèle, tableaux vides, symlinks et docs Prim ; backend construit et `purs` TAST. |
| Launcher JVM et résultat du processus | [test/entrypoint.mjs](../test/entrypoint.mjs) | 10 variantes × classes/JAR : 6 succès et 14 échecs JVM attendus ; entier/null/objet non callable, priorité Supplier, argument null, appel unique, erreurs d'action/initialisation/stub ; backend construit, `purs` TAST et JDK avec `jar`. |
| Propriété, publication et récupération Java | [test/output-files.mjs](../test/output-files.mjs) | 9 groupes Node : fichiers étrangers/modifiés, adoption, staging, six erreurs de renommage, ordre du launcher, `SIGKILL` à trois étapes, conflits de reprise, métadonnées et symlinks ; pas de build ni JDK. |
| Résolution, relevé et diagnostics FFI | [test/ffi-diagnostics.mjs](../test/ffi-diagnostics.mjs) | Huit modules, trois sélections adjacente/replis, huit erreurs JVM par binding, fragments incomplets/espaces et erreur de lecture ; backend construit, `purs` TAST, JDK, cible Java 17. |
| Ref, Promise et Aff Java | [test/ffi-runtimes.mjs](../test/ffi-runtimes.mjs) | 36 contrôles directs : effets différés, écritures concurrentes, règlement/adoption, exceptions, désabonnement, annulation, bracket, supervision et parallèle ; vrais fragments, shim Either, Node/JDK et trois ports voisins. |
| API PureScript des ports et pont Promise/Aff | [test/ffi-ports.mjs](../test/ffi-ports.mjs) | 17 assertions dans chacun des modes records typés/Maps, mêmes TAST ; attente de la fibre et échec JVM vérifiés. Relevé identique entre modes, fragments locaux identifiés, troisième génération avec `foreign` du registre pour diagnostiquer l'absence Java. Backend construit, Spago, `purs` TAST et ports locaux. |
| Complétion des suites asynchrones des ports | [test/port-runners.mjs](../test/port-runners.mjs) | Sélection `--port=aff\|promise\|promise-aff` ; 45/13/7 contrôles de suite, marqueur final et quatre sondes négatives par port. Workspaces isolés, backend construit, Spago/`purs` TAST, ports locaux et JDK ; Java 17. |
| Grand arbre de branches | [test/big-function.mjs](../test/big-function.mjs) | Prépare et exécute BigFunction dans un workspace temporaire isolé, puis réalise 155 contrôles de `f`. |
| Sélection, JDK, workspaces, processus | [test/test-tools.mjs](../test/test-tools.mjs) | 13 tests Node : sélection et absence d'effets, JDK/cible/runtime séparés, combinaisons invalides, conflit de cible avant nettoyage, préparation/FFI, logs, timeout et signaux aux descendants. |
| Prérequis, build et lancement source | [test/source-install.mjs](../test/source-install.mjs) | Six groupes Node/Bash avec commandes contrôlées : bon répertoire de build, dépendances/outils absents, neuf TAST incompatibles malgré version correcte, backend absent/incomplet, destination existante et prérequis d'installation ; aucun réseau ni build réel. |
| Installation complète et application autonome | [tools/install-source.mjs](../tools/install-source.mjs) | Sept références fetchées, fork GHC/Stack et backend reconstruits, Hello/Refs en Java 17 et JAR exécutés depuis un dossier JAR seul ; Spago 1.0.3, Stack, Git, Node, Bash, JDK complet et dépendances réseau/cache. |
| Compatibilité Java ciblée | [tools/check-jdk.mjs](../tools/check-jdk.mjs) | Six suites × trois configurations de compilation/exécution, avec chemins/versions, cible 17, sondes bytecode/JVM et logs ; backend construit, deux JDK, `purs` TAST, Spago et ports locaux. |
| Documentation et suivi | [tools/check-docs.mjs](../tools/check-docs.mjs) | Liens/ancres locaux, syntaxe des exemples Bash, inventaire des suites, options de `Config`, score du TODO et présence des preuves des lots cochés ; Node et Bash. |

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

### Entrée TAST stricte

Pour une modification du chargement ou de son contrat :

```bash
./bin/build
node test/input.mjs
```

La suite compile quatre modules avec `purs --codegen corefn,docs` dans un
workspace isolé : dépendances ordonnées, déclarations enrichies non vides,
module vide inutilisé, documentation de `Prim` et de ses sous-modules. Node,
le fork TAST et le backend construit suffisent.

Les entrées altérées couvrent JSON cassé/non-objet, métadonnées absentes/nulles/
non-tableaux, erreurs du décodeur PBO, CoreFn absent/répertoire/illisible, liens
cassés, répertoire parasite, doublon et dépendance manquante. `PrimMissing` ne
bénéficie pas de l'exemption `Prim.*`. Un CoreFn présent sous `Prim` est contrôlé.
Le test de permissions est omis si le processus est root.

Chaque refus est exercé avec `GOPURS_JOBS=1` puis `2`, en application avec une
sortie préexistante, puis en bibliothèque avec une destination neuve imbriquée.
Les assertions vérifient code 1, chemin/module du diagnostic, phase de chargement
échouée, absence de phase ultérieure, octets/inventaire Java/manifeste/caches
inchangés et absence de création de la destination. Les mutations sont restaurées
avant une dernière compilation valide.

Les cas valides confrontent sources et manifeste entre lectures à 1, 2 et 64,
replis de configuration invalide, symlinks de module/fichier, imports Prim et
fichiers ordinaires à la racine. Le [pilote ci-dessous](#pilote-de-compilation)
complète ces contrôles par une comparaison sur TAST figé, Spago et la JVM.

### Entrée JVM et JAR

Pour une modification de `Runtime.mainRunSource` ou de l'ABI du launcher :

```bash
./bin/build
node test/entrypoint.mjs
```

La suite prépare dix modules principaux et un module de types, avec TAST réels
issus du fork, puis utilise la CLI, `javac` et `jar`. Le `Main` par défaut est
l'entier `42`. Deux FFI invalides fournissent `null` et un objet dont `toString()`
lève une exception : le diagnostic doit nommer le champ et son type sans
déclencher cette méthode. Ces trois cas doivent produire **code JVM 1**.

Trois valeurs exécutables vérifient `Supplier.get()`, `Function.apply(null)` et
la priorité du premier pour un objet implémentant les deux interfaces. Les
compteurs et stdout vérifient l'appel unique ; un résultat `null` reste admis et
la valeur de retour est ignorée. Quatre autres cas vérifient la propagation des
exceptions Supplier, Function, initialisation statique et stub FFI manquant.

Chaque cas est lancé en classes, puis sous forme de `app.jar` dans un dossier
ne contenant que ce JAR, avec le dossier de la JVM seul sur `PATH`. Chaque phase
a son log distinct. Le résultat attendu est **6 succès et 14 échecs JVM** par
configuration Java. Le résolveur commun fournit la cible et la JVM ; `jar` vient
du même JDK que `javac`. La [validation M18](#validation-m18) couvre JVM 26 et 17
pour des classes compilées par JDK 26 en release 17.

### Pilote de compilation

Pour une modification de la CLI, de l'orchestration, de la FFI ou des sorties :

```bash
./bin/build
node test/driver.mjs
node --test test/output-files.mjs
```

Le pilote prépare quatre modules n'utilisant que `Prim`, puis appelle le `purs`
TAST du PATH avec `--codegen corefn`. Il crée aussi son propre workspace Spago
sans dépendances applicatives ; Spago et son package set `77.10.1` doivent être
disponibles. Le backend doit être construit ; le JDK est choisi par le résolveur
commun. Les compilations Java utilisent `--release 17`.

Les 11 variantes exercent les valeurs par défaut, les six options de désactivation
seules et combinées, `--main Chosen`, `--main=Chosen` et `--no-main`. Les dix cas
avec launcher sont exécutés sur la JVM : ABI `Supplier` pour `Main`, ABI `Function`
pour `Chosen` ; la bibliothèque est compilée avec `javac`. Les assertions
contrôlent aussi records, closures Int, chunks, fragments FFI fournis/vides/absents
et échappement d'un nom étranger réservé en Java.

L'aide et **12 erreurs d'arguments** sont exercées sans entrée TAST : code 0 ou 2
attendu et aucune écriture. Les **13 échecs de compilation/I/O** vérifient code 1,
diagnostic, total marqué `(failed)` et conservation de la génération précédente :
entrypoints absents, sans main, non exportés ou réexportés, entrée vide en mode
application, chevauchement des chemins, entrée absente, lecture FFI impossible,
destination bloquée et collisions avec un répertoire aux noms module/launcher/runtime.

Les générations successives vérifient changement de main, passage en bibliothèque
et Maps, retrait des records et du launcher obsolètes, suppression/renommage de
modules, empreintes du manifeste et conservation de Java/texte étrangers. Des
chemins TAST/Java avec espaces, destination imbriquée créée automatiquement et
alias `--output` sont utilisés. L'entrée vide en mode bibliothèque conserve
seulement `__IntFn.java` et le manifeste.

Deux vrais `spago build` exécutent un backend espion qui enregistre les arguments
puis lance Javapurs : configuration par défaut, puis `--output "TAST cache"`.
L'assertion vérifie les `backend.args` et l'ajout réel du chemin TAST absolu ; la
destination Java `Java sources` est configurée séparément. Chaque résultat est
compilé puis exécuté sur la JVM. Le workspace temporaire est supprimé au succès
et conservé à l'échec.

`output-files.mjs` importe directement le FFI filesystem de `Output`. Il injecte
une erreur à chacun des six renommages de publication et arrête un processus
enfant avec `SIGKILL` après un module, le manifeste ou le marqueur `committed`.
Les comparaisons portent sur l'inventaire et les octets de l'ancienne/nouvelle
génération, le fichier étranger conservé et l'ordre du launcher, même identique.
Les conflits, métadonnées invalides et alias symlinks vérifient les
chemins de refus et la conservation des preuves de reprise.
Depuis M14, les snapshots de publication/restauration incluent un relevé FFI
différent pour les deux générations, afin de vérifier leur cohérence avec le Java.

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
`purs` pour cette application figée, vérifie leurs empreintes, puis compare
inventaire et contenu exact de chaque fichier Java. Les fixtures de renommage et
Spago sont construites séparément. Ces deux modes gardent leur répertoire et leurs logs même
au succès. Employer les mêmes versions d'outils et le même environnement entre
les deux runs. Une référence pré-M13 reste comparable : `main-equals` utilise la
référence `chosen`, et la bibliothèque explicite utilise l'ancienne référence
`absent-main`. Le Java d'entrée vide est comparé avec `--no-main`. Les anciens
arguments tolérés sont désormais contrôlés comme des échecs, hors des snapshots.

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

### Passes spécialisées

Le [guide des passes](specialized-passes.md) relie reconnaissances, preuves,
transformations et replis à leurs suites. Pour ownership, après reconstruction :

```bash
./bin/build
node test/ownership.mjs
node test/ownership-admission.mjs
node test/ownership-loops.mjs
```

Les deux nouvelles suites entrent par `Pipeline.lowerModule`, puis renommage,
chunking, `javac --release 17` et JVM, avec ownership désactivé puis activé.
`ownership-admission.mjs` vérifie aussi la sélection directement par `prepare` :
alias égal/préfixe, arbres empruntés, continuations vivantes, cascade de refus,
layout ambigu et réservation des noms. Le runtime contrôle les snapshots et
l'identité de la cellule réutilisée ; les littéraux vérifient wrappers et bits IEEE.

`ownership-loops.mjs` passe les auto-appels sous alias arbre, alias scalaire et
`LetRec`, jusqu'à 100 000 itérations. Le harness JVM utilise `-Xss256k` pour
vérifier l'exécution en boucle. Ces fixtures synthétiques n'ont besoin que du
backend construit et du JDK commun. Choisir dans la matrice les autres suites
selon la passe et ses interactions : arité/initialisation pour `DirectCalls`,
pureté/cache pour les invariants, classification Int et boucle comptée pour
les représentations de boucle, partage pour `Reuse`.

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
| [port-test-runner](../tools/port-test-runner.mjs) | Copie des suites des trois ports, entrypoint attendu, inventaire d'assertions et sondes de fin de processus. |
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

Le script Ref se place dans son propre dépôt, reconstruit ses sorties et peut
sélectionner `spago.java.yaml` via le lien `spago.yaml`.
Il utilise le compilateur frère puis exécute `Test.Main` sur la JVM avec
`-Xss8m`. Consulter le script du port pour ses prérequis ; le runner agrégé
`tools/modtest-runner.mjs` est un autre niveau d'orchestration.

### Suites asynchrones des ports

Depuis le compilateur, sélectionner la suite du port modifié :

```bash
../javapurs-aff/bin/test
../javapurs-js-promise/bin/test
../javapurs-js-promise-aff/bin/test
```

Ces launchers délèguent à `node test/port-runners.mjs --port=NOM`, avec
`NOM=aff|promise|promise-aff`. Sans option, le script direct sélectionne ces trois
suites. Les options historiques `-c`/`--clean` reconstruisent le backend avant la
sélection exécutée ; chaque suite utilise ensuite un workspace temporaire neuf.
Les arguments inconnus ou une seconde sélection de port échouent avant le build.

Le support copie les sources `test/` du port (hors `Test.Bench`) et un entrypoint
`Test.PortRunner`. Il utilise le template des dépendances du compilateur avec les
ports Aff, Promise, Promise/Aff et Foreign explicitement sélectionnés. Il requiert
le backend construit, Spago, le frontend TAST, les ports locaux et un JDK complet.
Compilation en `--release 17`, exécution en `-Xss8m` ; les configurations et sorties
des checkouts de ports sont préservées.

L'entrypoint attend la fibre supervisée ou la Promise de la suite, puis imprime
`PORT SUITE COMPLETED`. Le runner exige ce marqueur unique et **45 contrôles Aff,
13 Promise ou 7 Promise/Aff**. Les nettoyages font partie de la suite attendue.
Les courses Aff utilisent des rendez-vous et acceptent les ordres indépendants
du scheduler ; le test parallèle est borné à **64 branches** pour les threads
ordinaires. Les chaînes profondes restent couvertes par `ffi-runtimes.mjs`.
Promise utilise des valeurs pending à règlement contrôlé et de vrais timers ;
les assertions et rejets passent par une chaîne observée, y compris le perdant
de la course et les finalizers.

Chaque commande vérifie ensuite quatre contre-exemples sur le même entrypoint
compilé : assertion après suspension, rejet tardif, absence de complétion et
sortie prématurée avec code 0. Les trois premiers doivent sortir en **1** avec le
diagnostic attendu ; le dernier doit être rejeté faute de marqueur. Le watchdog
normal est de **30 s** (processus JVM : **45 s**) ; la sonde de timeout le ramène
à **200 ms**, les deux sondes d'erreur à **5 s**. Chaque phase de build est bornée
à **120 s**. `purescript.log`, `generation.log`, `javac.log`, `execution.log` et
`probe-*.log` sont dans le sous-dossier `logs/` du temporaire, conservé à l'échec.
Les erreurs attendues des sondes restent dans leurs logs ; toute discordance
fait échouer la commande. Les temporaires réussis sont supprimés.

### Runtimes FFI et interopérabilité

Pour les [contrats runtime](ffi-runtime.md), depuis ce dépôt :

```bash
node test/ffi-diagnostics.mjs
node test/ffi-runtimes.mjs
node test/ffi-runtimes.mjs --port=aff
node test/ffi-ports.mjs
```

`ffi-diagnostics.mjs` prépare huit modules Prim-only et utilise le vrai résolveur
PBO via le pilote. Une FFI adjacente prime sur une copie concurrente dans `.spago` ;
deux autres modules exercent les replis package et workspace. Le relevé vérifie
chemins, origines, noms échappés, états et SHA-256. Huit appels JVM vérifient
`Module.binding` sur `Function.apply`, `Supplier.get` et méthodes varargs, pour
un fichier absent puis vide. Un fragment incomplet et un fragment d'espaces sont
`provided`/`not-checked` : leur compilation seule réussit, celle d'un consommateur
du binding omis échoue. Une erreur de lecture laisse le précédent rapport intact.

`ffi-runtimes.mjs` compile un harness partagé et les fragments réels Aff, Ref,
Promise avec `javac --release 17`, puis choisit les protocoles à exécuter.
`--port=refs|promise|aff` sélectionne un groupe ; `--ports-root CHEMIN` sélectionne
le dossier contenant les trois checkouts, utile pour une comparaison sauvegardée.
Il utilise **4** contrôles Ref (dont 2 000 mises à jour entre quatre threads),
**14** Promise et **18** Aff. Les barrières imposent les interleavings, avec des
timeouts d'échec. Deux chaînes de 20 000 étapes vérifient les trampolines avec
`-Xss512k`. Il ne dépend pas du build JavaScript du backend.

`ffi-ports.mjs` prépare un workspace isolé depuis le template du runner et ajoute
les ports Aff, Promise, Promise/Aff et Foreign. Ref et les dépendances communes
viennent du template. Il exécute les vrais modules PureScript/ADT avec **17**
assertions : Ref, joins réutilisés, bracket, annulation, supervision, course Unit,
pont et erreurs, `all`, `race`, `finally`, exception de handler et Promise.Lazy.
La seconde génération réutilise les mêmes TAST avec `--records=maps` ; les deux
compilations ciblent Java 17. Le helper `Main.awaitAff` attend la fibre racine,
propage son erreur et borne une absence de complétion ; le script exige aussi
le marqueur final. Aucune option CLI n'est acceptée.

Le relevé `ffi` des deux modes est identique et nomme les vrais fragments locaux
Aff/Ref/Promise/Foreign. Une troisième préparation Spago retire l'override
`foreign` et génère dans `java-registry` : son entrée `Foreign` doit être `missing`
et nommer `.spago/p/foreign-…/src/Foreign.purs`. Cette sonde de sélection ne lance
pas une fibre susceptible d'attendre une conversion absente. Les dépendances et
labels de couverture sont détaillés dans la
[table des quatre ports](ffi-runtime.md#couverture-exécutée-et-dépendances-des-quatre-ports).

Les launchers `../javapurs-{refs,aff,js-promise}/bin/test-runtime` délèguent au
groupe direct correspondant ; `../javapurs-js-promise-aff/bin/test-runtime`
lance l'intégration. Ils retrouvent les scripts depuis leur propre chemin et
acceptent les mêmes arguments que leur cible. Les temporaires sont supprimés
au succès, conservés à l'échec ; l'intégration garde alors ses logs par phase.

**Constat historique M10, traité par M12.** Les anciens `bin/test` Aff et
Promise/Aff pouvaient quitter avec 0 avant leurs fibres daemon. Les timers
Promise retournaient des valeurs déjà réglées et les Promises enfants n'étaient
pas toutes observées. Les preuves M10 reposent sur les protocoles directs et
l'intégration attendue ci-dessus ; les nouvelles
[suites de ports](#suites-asynchrones-des-ports) apportent leur propre validation.
Les tests synchrones Ref restent exécutables par leur entrypoint historique.

### Installation source

Pour les frontières de prérequis et de lancement, sans télécharger de dépendances :

```bash
node --test test/source-install.mjs
```

Pour reconstruire les références de [source-lock.json](../tools/source-lock.json)
et vérifier l'ensemble du parcours jusqu'aux deux JAR :

```bash
node tools/install-source.mjs /chemin/vers/un-workspace-neuf
```

Le dossier doit être absent. Le backend est exporté depuis le checkout appelant,
sans son build suivi dans Git. Les versions/empreintes, commandes et résultats
figurent dans `installation.json`, les logs par phase sous `logs/` et `apps/`.
Le smoke d'application se rejoue séparément avec
[source-smoke.mjs](../tools/source-smoke.mjs) ; voir le
[contrat d'installation](installation.md#parcours-exécuté).

## Consigner une validation

Le [guide d'entretien](maintenance.md) donne le parcours de reprise, le statut
des sorties/sauvegardes et la politique de conservation des journaux. La cohérence
documentaire se vérifie depuis n'importe quel dossier en appelant le script par
son chemin, ou depuis ce dépôt :

```bash
node tools/check-docs.mjs
```

Ce contrôle lit les guides du compilateur, le TODO parent et les README des quatre
ports M10. Il suppose le layout local documenté ; les liens distants ne sont pas
interrogés. Les exemples shell passent par `bash -n` sans être exécutés.

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
[M14](#validation-m14) ; `references-final.json` confirme ces SHA et leurs
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
