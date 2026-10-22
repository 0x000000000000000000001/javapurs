# Tests ciblés et registre de validation

État documenté au **21 octobre 2026**. Les commandes de cette page s'exécutent
depuis le dépôt du compilateur `htdocs/javapurs/javapurs`, sauf indication contraire.
Pour une première reprise, voir [Démarrer et valider](start-here.md).

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
| Protocoles des ports Java | `test/ffi-runtimes.mjs` compile les vrais fragments ; `test/ffi-ports.mjs` attend l'intégration PureScript réelle dans deux modes de records, en classes/JAR. Les cinq ports proposent `bin/test-runtime`. |
| Suite d'un port | Les 48 `bin/test` délèguent à `test/port-runners.mjs` : profils explicites et workspaces isolés, suites synchrones ou attendues avec sondes d'échec. Aucune sélection exécutable n'est rejetée ; 7 ports auxiliaires sont documentés. [Inventaire et limites](port-launchers.md). |
| Validation agrégée | [tools/check-all.mjs](../tools/check-all.mjs) : `--quick` pour docs/ports/sorties, `--full` pour Spec, test-tools, child-process et Node FS ; logs dans `logs/check-all/`. |
| Documentation/outillage | `tools/check-docs.mjs` contrôle liens/ancres, exemples shell, matrice/options et score ; les suites d'outillage vérifient les contrats des processus modifiés. |

La règle du [plan de travail actif](../todo.md) est une **validation
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
  `fixture-runner`/`bin/test`, `port-test-runner` (48 sélections de ports) et les
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
séparé ; le dossier du JDK de build reste sur `PATH`.
Les 48 launchers de ports délégués à Node et les cinq `test-runtime` les prennent
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
| Workers directs, arité et ordre d'initialisation | [test/direct-calls.mjs](../test/direct-calls.mjs) | Saturation, partielles, surapplication, eager/lazy, frontières d'exception et gardes imbriquées sans expansion exponentielle ; 40 contrôles JVM par mode. |
| Fonctions Int et ABI publique | [test/int-functions.mjs](../test/int-functions.mjs) | Appels primitifs/génériques, captures et comportement d'évaluation. |
| Opérateurs numériques | [test/operators.mjs](../test/operators.mjs) | Division/modulo Int et égalité Number confrontés aux références sémantiques. |
| Réutilisation des constructeurs | [test/constructor-reuse.mjs](../test/constructor-reuse.mjs) | Réécriture AST et exécution des cas de partage. |
| Ownership et workers consommateurs | [test/ownership.mjs](../test/ownership.mjs) | Sélection, fraîcheur, cas polymorphes/locaux, génération et exécution. |
| Admission ownership, alias, cellules et littéraux | [test/ownership-admission.mjs](../test/ownership-admission.mjs) | 11 admissions/refus, 28 contrôles JVM en mode persistant et 31 avec ownership : snapshots, identité des cellules, Char/String et nombres IEEE ; `--simple-scalars` isole le cas Char sans erreur d'échappement. |
| Cibles des boucles ownership | [test/ownership-loops.mjs](../test/ownership-loops.mjs) | 9 contrôles JVM par mode : alias arbre/scalaire et scope récursif, 0/1/100 000 itérations avec `-Xss256k`. |
| `Chunk`, `Chunk.Captures`, `Chunk.Extraction` | [test/chunk.mjs](../test/chunk.mjs) | 15 fixtures : captures imbriquées, portées, types Java, récursion, mutations, ordre des effets, scopes profonds, boucles et frontières 256/257 unités, 64/65 captures. |
| Configuration, pilote, pipeline, FFI et émission | [test/driver.mjs](../test/driver.mjs) | 11 variantes CLI, aide, 25 échecs attendus, deux ABI de launcher, bibliothèque/entrée vide, générations successives et trois builds Spago réels ; `purs` TAST, Spago, backend construit et JDK. Comparaison du Java sur entrées figées. |
| Entrée TAST stricte et graphe des imports | [test/input.mjs](../test/input.mjs) | Erreurs filesystem/JSON/décodage/métadonnées, doublons et imports manquants ; sorties/caches préservés, destination neuve absente, lecture séquentielle/parallèle, tableaux vides, symlinks et docs Prim ; backend construit et `purs` TAST. |
| Launcher JVM et résultat du processus | [test/entrypoint.mjs](../test/entrypoint.mjs) | 10 variantes × classes/JAR : 6 succès et 14 échecs JVM attendus ; entier/null/objet non callable, priorité Supplier, argument null, appel unique, erreurs d'action/initialisation/stub ; backend construit, `purs` TAST et JDK avec `jar`. |
| Propriété, publication et récupération Java | [test/output-files.mjs](../test/output-files.mjs) | 9 groupes Node : fichiers étrangers/modifiés, adoption, staging, six erreurs de renommage, ordre du launcher, `SIGKILL` à trois étapes, conflits de reprise, métadonnées et symlinks ; pas de build ni JDK. |
| Résolution, relevé et diagnostics FFI | [test/ffi-diagnostics.mjs](../test/ffi-diagnostics.mjs) | Huit modules, trois sélections adjacente/replis, huit erreurs JVM par binding, fragments incomplets/espaces et erreur de lecture ; backend construit, `purs` TAST, JDK, cible Java 17. |
| Exceptions, Ref, Promise et Aff Java | [test/ffi-runtimes.mjs](../test/ffi-runtimes.mjs) | 49 contrôles directs : noms/traces/causes, identité Throwable, effets différés, écritures concurrentes, règlement/adoption, désabonnement, annulation, bracket, supervision et parallèle ; vrais fragments, référence JS Exceptions, shim Either, Node/JDK et quatre ports voisins. |
| API PureScript des ports et pont Promise/Aff | [test/ffi-ports.mjs](../test/ffi-ports.mjs) | 25 assertions × records typés/Maps × classes/JAR, mêmes TAST ; attente de la fibre, inventaire et marqueur final vérifiés. Relevé identique entre modes, fragments locaux identifiés, troisième génération avec `foreign` du registre pour diagnostiquer l'absence Java. Backend construit, Spago, `purs` TAST, ports locaux et JDK avec `jar`. |
| Spawn Java `node-child-process` | [test/child-process.mjs](../test/child-process.mjs) | Workspace isolé et probe Java sur `spawn` : stdout `child-ok`, code 0 et rejeu d'un `exit` tardif ; port construit et JDK. Complète la validation M32. |
| Suites et complétion des ports | [test/port-runners.mjs](../test/port-runners.mjs) | 48 sélections `--port=NOM` ([inventaire](port-launchers.md)) : **41 synchrones (dont Node FS, Node Net et Node HTTP avec wrapper Aff), sept attendues, aucune rejetée** faute de protocole. Aff/Promise/Promise-Aff : 45/13/7 contrôles et quatre sondes chacune. UUID/Event Emitter : Spec attendue, **6/19 résultats exigés**, cinq sondes chacune ; les deux suites passent depuis M25. Yoga JSON : **52/52**, cinq sondes depuis M29. Spec pur : **62/62**, trois pending, cinq sondes depuis M30. Node HTTP : suite complète et upgrades depuis M31. Node Streams (M26), Node FS (M27) et Node Net (M28) sont validés. Options strictes, sources/configurations préservées, phases bornées/loggées, pile Strings 64 Mio. Backend construit, Spago/`purs` TAST, ports locaux et JDK ; cible 17 par défaut. |
| Grand arbre de branches | [test/big-function.mjs](../test/big-function.mjs) | Prépare et exécute BigFunction dans un workspace temporaire isolé, puis réalise 155 contrôles de `f`. |
| Sélection, JDK, workspaces, processus | [test/test-tools.mjs](../test/test-tools.mjs) | 27 tests Node : sélection/aide sans effets, JDK/cible/runtime séparés, profils de dépendances/FFI, 45 gabarits historiques (dont dépendances vides), chemins validés avant écriture, sources/symlinks/outputs préservés, ressources/espaces, 45 délégations, rejets explicites et contrôle des résultats Spec, cinq échecs de phase, quatre timeouts et signaux aux descendants. |
| Prérequis, build et lancement source | [test/source-install.mjs](../test/source-install.mjs) | Six groupes Node/Bash avec commandes contrôlées : bon répertoire de build, dépendances/outils absents, neuf TAST incompatibles malgré version correcte, backend absent/incomplet, destination existante et prérequis d'installation ; aucun réseau ni build réel. |
| Installation complète et application autonome | [tools/install-source.mjs](../tools/install-source.mjs) | Sept références fetchées, fork GHC/Stack et backend reconstruits, Hello/Refs en Java 17 et JAR exécutés depuis un dossier JAR seul ; Spago 1.0.3, Stack, Git, Node, Bash, JDK complet et dépendances réseau/cache. |
| Compatibilité Java ciblée | [tools/check-jdk.mjs](../tools/check-jdk.mjs) | Six suites × trois configurations de compilation/exécution, avec chemins/versions, cible 17, sondes bytecode/JVM et logs ; backend construit, deux JDK, `purs` TAST, Spago et ports locaux. |
| Matrice FFI des ports | [tools/check-port-ffi.mjs](../tools/check-port-ffi.mjs) et [matrice](port-ffi.md) | 48 ports standards, 7 auxiliaires et 118 fichiers Java reliés à leurs profils. |
| Sorties générées | [tools/check-generated.mjs](../tools/check-generated.mjs) | Double build et comparaison SHA-256 des 1 028 fichiers JS/source maps suivis. |
| Configurations des ports | [tools/check-port-configs.mjs](../tools/check-port-configs.mjs) | Launchers génériques, profils standards, 7 ports auxiliaires, noms/paths locaux et package set 77.7.0. |
| Documentation et suivi | [tools/check-docs.mjs](../tools/check-docs.mjs) | Liens/ancres locaux, syntaxe des exemples Bash, inventaire des suites, options de `Config`, score du TODO et présence des preuves des lots cochés ; Node et Bash. |

Pour une modification de `JavaAst` ou de `Printer`, choisir les lignes qui
utilisent les nœuds modifiés et vérifier leurs parcours dans les passes
consommatrices. Pour `Main`, la CLI ou l'insertion FFI, utiliser `driver.mjs`,
éventuellement complété par une fixture nommée pertinente ; les scripts AST seuls
ne couvrent pas l'orchestration. Les fixtures CLI simulées de `test-tools.mjs`
couvrent le runner, celles de `driver.mjs` le compilateur réel.

Les suites `chunk`, `tco`, `counted-loops`, `int-functions`, `loop-invariants`,
`ownership`, `direct-calls` et `typed-records` utilisent les templates construits
de `Javapurs.Runtime` pour `TcoLoop` et, lorsque nécessaire, `__IntFn`. Leur
support Java est compilé dans des fichiers séparés ; les assertions restent
propres aux suites. Voir la [validation M20](#validation-m20).

### Entrées optionnelles de benchmarks

Ces options étendent certaines suites à un projet dont le frontend a déjà
produit le TAST :

| Script | Option | Entrée et préparation |
| --- | --- | --- |
| `int-loops.mjs` | `--polymorphism-project CHEMIN` | Ancien accès direct aux `.purmeta` de `Test.Polymorphism` et `Test.RBTree` ; limite ci-dessous. |
| `loop-invariants.mjs` | `--lazy-project CHEMIN` | TAST de `Test.LazyEvaluation` et de ses imports, optimisation isolée. |
| `direct-calls.mjs` | `--rbtree-project CHEMIN` | TAST de `Test.RBTree` et de ses imports, optimisation isolée. |
| `int-functions.mjs` | `--church-project CHEMIN` | TAST de `Test.Church` et de ses imports, optimisation isolée. |
| `typed-records.mjs` | `--records-project CHEMIN` | TAST de `Test.Records` et de ses imports, optimisation isolée ; source `src/Test/Records.purs` également vérifiée. |

Les quatre dernières suites utilisent
[optimized-module.mjs](../test/support/optimized-module.mjs). Le layout attendu
est `CHEMIN/run/bak/java/output/<Module>/corefn.json`. Le helper copie uniquement
la fermeture d'imports du module choisi, la valide avec `Javapurs.Input`, puis
utilise le builder séquentiel, les directives et sémantiques FFI usuelles de PBO.
Le build et la lecture des implémentations partagent le même processus et dossier
temporaire ; le scope est libéré et le dossier appelant restauré ensuite.
Les sources/TAST/caches du projet restent intacts. Un échec conserve le workspace
temporaire pour diagnostic. Ces options ne relancent ni Spago ni le frontend.

Le [contrat PBO](../../../purescript-backend-optimizer-javapurs/docs/purmeta-cache.md)
refuse les implémentations non publiées dans le build courant : la présence
d'anciens `.purmeta` ne suffit pas. Le parcours optionnel `int-loops`, hors des
huit suites M20, conserve encore cet ancien accès direct et nécessite une reprise
avant utilisation autonome ; son parcours synthétique Node reste distinct.

Exemples ciblés, avec le projet existant ou une copie figée de ses entrées :

```bash
node test/direct-calls.mjs --rbtree-project "$BENCHMARK_PROJECT"
node test/typed-records.mjs --records-project "$BENCHMARK_PROJECT"
node test/typed-records.mjs --records-project "$BENCHMARK_PROJECT" --records=maps
```

## Préparation des workspaces

[prepareWorkspace](../tools/fixture-runner.mjs) vérifie le backend construit puis
délègue la configuration à [workspace-config](../tools/workspace-config.mjs).
Le gabarit par défaut reste [tests/runner/spago.yaml](../tests/runner/spago.yaml) :
18 dépendances directes, 19 sélections locales et package set **77.10.1**.
Le troisième argument optionnel sélectionne un profil :

| Profil | Dépendances ajoutées au gabarit | Ports locaux ajoutés |
| --- | --- | --- |
| `fixture` (défaut) | Aucune. | Aucun. |
| `ffi-ports` | `aff`, `js-promise`, `js-promise-aff`, `either`, `maybe`, `parallel`. | Aff, Promise, Promise/Aff et Foreign. |
| `port-suite` | Celles de l'intégration, plus `foreign`, `datetime`, `transformers`, `control`, `bifunctors`. | Les mêmes quatre ports. |

La sélection locale est définie une seule fois ; `foreign` reste une dépendance
transitive de l'intégration et directe des suites de ports. L'option
`registryPackages: ["foreign"]` retire uniquement son override local pour la
sonde négative de l'intégration. Un nom inconnu est refusé.

Le lecteur accepte le sous-ensemble maintenu des gabarits : nom du package,
listes de dépendances (y compris `[]` explicite), bloc `test` optionnel avec entrypoint/dépendances,
package set de registre et packages locaux à chemins JSON-quotés. Une structure
inattendue, un doublon dans le gabarit, un chemin local contradictoire ou un
checkout requis absent provoque un diagnostic avant l'écriture du workspace.
Les chemins sont rebasés depuis le dossier du gabarit, avec espaces conservés.

L'option `template` permet de fournir un autre gabarit : sa version de package
set et son bloc de test sont conservés. Les 45 profils historiques utilisent
leur `spago.java.yaml` en **77.7.0**, y compris UUID/Event Emitter ; les trois
suites Aff/Promise/Promise-Aff conservent le runner **77.10.1**. Cette distinction
est vérifiée par les sondes et les exécutions réelles.
Le gabarit source reste intact, y compris lorsque le runner est désigné par un
alias filesystem. Un profil enrichi appliqué au gabarit source, ou une destination
`spago.yaml` liée à une autre configuration, est refusé. Seul le fichier du
workspace préparé est écrit. Les runners copient ensuite les sources et leurs
FFI auxiliaires ; les tests contrôlent la conservation des originaux.

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
2. Le runner remplace `tests/runner/src` et `output`, dont `output/java/classes`.
3. Une FFI Java adjacente prime sur `tests/ffi/NOM.java` ; la FFI JavaScript
   adjacente, lorsqu'elle existe, satisfait la compilation PureScript.
4. Il appelle Spago, Javapurs, `javac`, puis `java -cp output/java/classes MainRun`.
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

Trois vrais `spago build` exécutent un backend espion qui enregistre les arguments
puis lance Javapurs : configuration par défaut, répétition avec classes présentes,
puis `--output "TAST cache"`. L'assertion vérifie les `backend.args` et l'ajout réel
du chemin TAST absolu ; la destination Java suit ce chemin sous `java/`. Chaque résultat est
compilé puis exécuté sur la JVM. Le workspace temporaire est supprimé au succès
et conservé à l'échec.

`output-files.mjs` importe directement le FFI filesystem de `Output`. Il injecte
une erreur à chacun des six renommages de publication et arrête un processus
enfant avec `SIGKILL` après un module, le manifeste ou le marqueur `committed`.
Les comparaisons portent sur l'inventaire et les octets de l'ancienne/nouvelle
génération, le fichier étranger conservé et l'ordre du launcher, même identique.
Les conflits, métadonnées invalides et alias symlinks vérifient les
chemins de refus et la conservation des preuves de reprise.
Le sous-arbre réservé `java/` est accepté, y compris via un alias de la racine
TAST ; les symlinks qui le redirigent vers un module restent refusés.
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
| [fixture-runner](../tools/fixture-runner.mjs) | Préparation de la fixture/FFI et phases jusqu'à la JVM. |
| [workspace-config](../tools/workspace-config.mjs) | Gabarits, profils de dépendances et sélections locales, rebasing et validation avant écriture. |
| [port-test-runner](../tools/port-test-runner.mjs) | Options strictes, 48 sélections de ports, sources/ressources, entrypoint, cible/pile Java, phases bornées et protocoles de fin explicites. |
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

Les 48 `bin/test` délèguent à `test/port-runners.mjs`. Les profils exécutables
nécessitent Node, le backend construit dans le dépôt voisin `javapurs/`, Spago,
le frontend TAST, leurs ports locaux et un JDK complet. Le
[relevé des 45 profils historiques](port-launchers.md) donne chaque révision,
entrypoint, ressource, configuration et résultat de validation. Les pilotes M22 :

| Profil | Entrypoint source | Sources et ressources copiées | Configuration | Pile |
| --- | --- | --- | --- | --- |
| `refs` | `test/Main.purs`, `Test.Main.main :: Effect Unit` | `src/`, `test/`, avec les FFI adjacentes ; aucune ressource externe à ces arbres. | `spago.java.yaml`, package set 77.7.0. | JVM `-Xss8m`. |
| `exceptions` | `test/Main.purs`, même protocole synchrone. | Mêmes arbres, FFI Exceptions incluse. | Même gabarit propre au port, 77.7.0. | JVM `-Xss8m`. |
| `strings` | `test/Test/Main.purs`, même protocole synchrone, huit modules de test appelés. | Mêmes arbres ; arborescence imbriquée conservée. | Même gabarit propre au port, 77.7.0. | `javac -J-Xss64m`, JVM `-Xss64m`. |

Le retour de ces actions synchrones et le code de sortie JVM déterminent le
résultat ; toute assertion levée échoue. Les actions asynchrones utilisent leurs
wrappers attendables décrits ci-dessous. Les déclarations de profil dans
[port-test-runner](../tools/port-test-runner.mjs) portent ce protocole explicitement.
Prelude et Partial conservent leurs entrypoints fonctionnels synchrones, déjà
acceptés par `MainRun` ; Partial ne contient pas d'assertion d'exécution.

Exécutions ciblées équivalentes depuis le compilateur :

```bash
node test/port-runners.mjs --port=refs
../javapurs-exceptions/bin/test
../javapurs-strings/bin/test
../javapurs-refs/bin/test --help
../javapurs-arrays/bin/test
../javapurs-node-path/bin/test
../javapurs-uuid/bin/test
```

Chaque lancement prépare un workspace temporaire neuf. La configuration est
rebasée et les seules sources/ressources déclarées sont copiées ; configuration,
lockfile, caches et anciens outputs du port source sont préservés. L'aide reste
sans effet, même avec `-c`. Une option inconnue, un nom de port invalide ou une
seconde sélection échoue avec le code **2** avant outils/build/préparation.

`-c`/`--clean` appelle le `bin/build` du compilateur, depuis sa racine et avec
l'environnement Java résolu, avant la première suite. Cette phase et Spago,
génération, `javac` sont bornées à **120 s** chacune ; l'exécution JVM à **45 s**.
Les logs séparés résident dans le workspace ; celui-ci est supprimé au succès,
conservé avec son chemin à l'échec. SIGINT/SIGTERM sont transmis aux descendants,
avec sorties **130/143** du runner. La cible `JAVAPURS_JAVA_RELEASE` (17 par défaut)
et la JVM `JAVAPURS_JAVA_RUNTIME` restent indépendantes des réglages de pile.

**UUID et Node Event Emitter** exposent leur Spec originale au wrapper
`Test.PortRunner`. Il attend l'Aff, vérifie les résultats de `evalSpecT` avec
`exit = false` et rejette échecs/pending ; le launcher exige respectivement
**6 et 19 succès**, puis le marqueur final. Aux quatre sondes asynchrones
ci-dessous s'ajoute une assertion suspendue capturée par Spec. Le graphe de
dépendances initial est conservé ; le support Java partage la frontière d'attente
de `Runner.java` et compose seulement `Aff.java` ou `Promise.java` selon le port.
La suite Event Emitter échouait en M23 sur une conversion Boolean/Supplier ; sa
FFI est corrigée et couverte par cinq régressions depuis [M25](#validation-m25).

**Node HTTP** a rejoint les protocoles validés en M31 : `testHttp` exécute les
serveurs locaux, les requêtes externes et attend `testUpgradeAff`. Les en-têtes
sont normalisés, le serveur émet `upgrade`, le client conserve le socket 101 et
ne lit pas de corps après upgrade. Aucune sélection n'est plus rejetée.

**Node Streams** est sorti de cette liste en M26 : un historique borné par
`ReadableStream` est rejoué au listener ajouté plus tard, ce qui émule le tampon
Node sans changer l'EventEmitter général. La suite passe en synchrone avec un
test explicite de listener tardif.

**Node FS** est sorti en M27 : les streams de fichier terminent par `end`,
`TestAff.testAff` est attendu par un wrapper dédié, et le flux de fichier atteint
`all good` avant le marqueur commun.

**Node Net** est sorti en M28 : `testNet` attend la fermeture finale du socket,
le wrapper `Net.purs` joint cette action, et `addressTcpImpl` renvoie désormais
le `Nullable` attendu plutôt qu'un `Maybe`. Le cycle serveur/client complet est
observé avant le marqueur.

**Yoga JSON** est sorti en M29 : sa composition explicite de quatre Specs évite
`spec-discovery`, et les corrections `Foreign.undefined`, index de tableau,
BigInt et dates ISO portent la suite à **52/52** avec cinq sondes.

**Spec** est validé en M30 pour sa partie pure et en M32 pour l'intégration :
`pureSpec` couvre six modules déterministes et `SpecFull` exécute les huit cas
d'intégration avec le `spago` local, soit **70/70 checks** et cinq sondes.

### Suites asynchrones des ports

Depuis le compilateur, sélectionner la suite du port modifié :

```bash
../javapurs-aff/bin/test
../javapurs-js-promise/bin/test
../javapurs-js-promise-aff/bin/test
```

Ces launchers délèguent à `node test/port-runners.mjs --port=NOM`, avec
`NOM=aff|promise|promise-aff`. Sans option, le script direct sélectionne ces trois
suites. Les options, phases bornées, choix Java et cycle de vie des workspaces
sont ceux du parcours commun décrit ci-dessus.

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
node test/ffi-runtimes.mjs --port=exceptions
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

`ffi-runtimes.mjs` compile un harness partagé et les fragments réels Exceptions,
Aff, Ref, Promise avec `javac --release 17`, puis choisit les protocoles à exécuter.
`--port=exceptions|refs|promise|aff` sélectionne un groupe ; `--ports-root CHEMIN`
sélectionne le dossier contenant les quatre checkouts, utile pour une comparaison
sauvegardée. Il utilise **13** contrôles Exceptions, **4** Ref (dont 2 000 mises à
jour entre quatre threads), **14** Promise et **18** Aff. Le groupe Exceptions
vérifie aussi la référence JS pour les noms, en-têtes, causes et identités ; les
protocoles JVM couvrent exceptions vérifiées et `java.lang.Error`, erreurs de
handler et passage via Aff/Promise. Les barrières imposent les interleavings, avec des
timeouts d'échec. Deux chaînes de 20 000 étapes vérifient les trampolines avec
`-Xss512k`. Il ne dépend pas du build JavaScript du backend.

`ffi-ports.mjs` prépare un workspace isolé depuis le template du runner et ajoute
les ports Aff, Promise, Promise/Aff et Foreign. Ref et les dépendances communes
viennent du template. Il exécute les vrais modules PureScript/ADT avec **25**
assertions : Exceptions (constructeurs, noms, traces, causes, identité via
catch/Aff/Promise), Ref, joins réutilisés, bracket, annulation, supervision, course Unit,
pont et erreurs, `all`, `race`, `finally`, exception de handler et Promise.Lazy.
La seconde génération réutilise les mêmes TAST avec `--records=maps` ; les deux
compilations ciblent Java 17. Chaque mode est exécuté en classes puis depuis un
dossier ne contenant que `app.jar`, avec le dossier JVM seul sur `PATH` et sans
`CLASSPATH` externe. Le helper `Main.awaitAff` attend la fibre racine, propage son
erreur et borne une absence de complétion ; le script exige aussi les 25 lignes
d'assertions et un marqueur final unique. Aucune option CLI n'est acceptée.

Le relevé `ffi` des deux modes est identique et nomme les vrais fragments locaux
Exceptions/Aff/Ref/Promise/Foreign. Une troisième préparation Spago retire l'override
`foreign` et génère dans `java-registry` : son entrée `Foreign` doit être `missing`
et nommer `.spago/p/foreign-…/src/Foreign.purs`. Cette sonde de sélection ne lance
pas une fibre susceptible d'attendre une conversion absente. Les dépendances et
labels de couverture sont détaillés dans la
[table des ports](ffi-runtime.md#couverture-exécutée-et-dépendances-des-ports).

Les launchers `../javapurs-{exceptions,refs,aff,js-promise}/bin/test-runtime` délèguent au
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

Ce contrôle lit les guides du compilateur, le plan v2 archivé, le TODO parent et
les README des 48 ports délégués. Il suppose le layout local documenté ; les liens
distants ne sont pas interrogés. Les exemples shell passent par `bash -n` sans être
exécutés.

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

## Validations historiques

Les récits détaillés M01–M32 sont conservés dans
[l’historique des validations](validation-history.md). Cette page garde les
ancres utilisées par le README, les plans et les guides.

<a id="historique-des-validations"></a>
<a id="validation-m01"></a>
<a id="validation-m02"></a>
<a id="livrables-et-décisions"></a>
<a id="défaut-révélé-par-le-rejeu-des-appels-directs"></a>
<a id="commandes-et-résultats"></a>
<a id="validation-m03"></a>
<a id="validation-m04"></a>
<a id="défauts-reproduits-sur-la-base"></a>
<a id="comparaison-du-java"></a>
<a id="validation-m05"></a>
<a id="validation-m06"></a>
<a id="défaut-dévaluation-reproduit-et-corrigé"></a>
<a id="validation-m07"></a>
<a id="défaut-déchappement-reproduit"></a>
<a id="comparaisons"></a>
<a id="validation-m08"></a>
<a id="livrables-et-contrats"></a>
<a id="comparaisons-et-clôture"></a>
<a id="validation-m09"></a>
<a id="deux-défauts-reproduits-puis-corrigés"></a>
<a id="validation-m10"></a>
<a id="responsabilités-et-livrables"></a>
<a id="défauts-reproduits-et-corrections"></a>
<a id="comparaison-java-et-clôture"></a>
<a id="validation-m11"></a>
<a id="revue-et-décisions"></a>
<a id="vérifications-ciblées"></a>
<a id="validation-m12"></a>
<a id="changements-et-défauts-exposés"></a>
<a id="validation-m13"></a>
<a id="références-et-périmètre"></a>
<a id="changements-livrés"></a>
<a id="nettoyage-demandé-pendant-le-lot"></a>
<a id="preuves-et-limites"></a>
<a id="validation-m14"></a>
<a id="livrables-et-contrat"></a>
<a id="validation-m15"></a>
<a id="sources-et-outils-effectivement-employés"></a>
<a id="livrables"></a>
<a id="limites-de-la-preuve"></a>
<a id="validation-m16"></a>
<a id="références-et-outils"></a>
<a id="contrat-livré"></a>
<a id="preuves-revue-et-limites"></a>
<a id="validation-m17"></a>
<a id="constat-et-références"></a>
<a id="preuves-et-portée"></a>
<a id="validation-m18"></a>
<a id="constat-références-et-correction"></a>
<a id="nettoyage-demandé-après-m18"></a>
<a id="validation-m19"></a>
<a id="livrables-et-contrôles-ciblés"></a>
<a id="revue-préalable-au-plan-v3"></a>
<a id="validation-m20"></a>
<a id="comparaison-et-clôture"></a>
<a id="validation-m21"></a>
<a id="conservation-et-clôture"></a>
<a id="validation-m22"></a>
<a id="références-et-contrat"></a>
<a id="exécutions-et-sondes"></a>
<a id="comparaison-et-conservation"></a>
<a id="validation-m23"></a>
<a id="références-et-inventaire"></a>
<a id="comparaison-et-préservation"></a>
<a id="validation-m24"></a>
<a id="périmètre-et-références--89-octobre-2026"></a>
<a id="résultats-ciblés"></a>
<a id="expansion-des-gardes-dappels-directs"></a>
<a id="migration-des-anciens-artefacts-b8x"></a>
<a id="complément-runj--9-octobre-2026"></a>
<a id="validation-m25"></a>
<a id="périmètre-et-référence--19-octobre-2026"></a>
<a id="causes-et-corrections"></a>
<a id="validation-m26"></a>
<a id="périmètre-et-correction--19-octobre-2026"></a>
<a id="validation-m27"></a>
<a id="validation-m28"></a>
<a id="validation-m29"></a>
<a id="périmètre-et-corrections--20-octobre-2026"></a>
<a id="validation-m30"></a>
<a id="périmètre-et-correction--20-octobre-2026"></a>
<a id="validation-m31"></a>
<a id="validation-m32"></a>
<a id="intégration-spec-via-node-child-process--20-octobre-2026"></a>

<a id="validation-m01"></a>
<a id="validation-m02"></a>
<a id="validation-m03"></a>
<a id="validation-m04"></a>
<a id="validation-m05"></a>
<a id="validation-m06"></a>
<a id="validation-m07"></a>
<a id="validation-m08"></a>
<a id="validation-m09"></a>
<a id="validation-m10"></a>
<a id="validation-m11"></a>
<a id="validation-m12"></a>
<a id="validation-m13"></a>
<a id="validation-m14"></a>
<a id="validation-m15"></a>
<a id="validation-m16"></a>
<a id="validation-m17"></a>
<a id="validation-m18"></a>
<a id="validation-m19"></a>
<a id="validation-m20"></a>
<a id="validation-m21"></a>
<a id="validation-m22"></a>
<a id="validation-m23"></a>
<a id="validation-m24"></a>
<a id="validation-m25"></a>
<a id="validation-m26"></a>
<a id="validation-m27"></a>
<a id="validation-m28"></a>
<a id="validation-m29"></a>
<a id="validation-m30"></a>
<a id="validation-m31"></a>
<a id="validation-m32"></a>

| Lots | Historique |
| --- | --- |
| M01–M11 | Plans v1 et maintenabilité initiale |
| M12–M19 | Plan v2 et compléments |
| M20–M32 | Plan v3 et compléments |

## Validation M41

### Baseline et cartographie — 21 octobre 2026

`M41` ouvre le plan v4 par une cartographie et une mesure de dette, sans modifier
de code exécutable. La [carte du code](code-map.md) décrit le flux
`Main` → `Config` → `Driver` → `Input`/PBO → `Pipeline` → `Emit`, les modules du
backend, le harnais de tests, les ports et les artefacts.

### Mesures de départ

| Mesure | Valeur |
| --- | ---: |
| Lignes PureScript du compilateur (`src/**/*.purs`) | 5 355 |
| Fichiers Java FFI de ports (`javapurs-*/src/**/*.java`) | 139 |
| Lignes Java FFI de ports | 8 643 |
| Ports avec `src/`, `test/`, `bin/test`, `spago.java.yaml` | 49 |
| Suites directes listées par la matrice | 30 |
| `docs/testing.md` | 3 556 lignes |
| `test/test-tools.mjs` | 677 lignes |
| `TODO`/`FIXME`/`HACK`/`XXX` dans `src`, `test`, `tools` | 3 |

Les dix points de friction priorisés sont dans la
[section « Dette priorisée »](code-map.md#dette-priorisée-pour-le-plan-v4).
Ils alimentent M42 (compilateur), M43 (FFI/runtime), M44 (harnais) et M45
(docs/clôture).

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `docs/code-map.md` | Créé ; pipeline, modules, harnais, ports, artefacts et dix priorités. |
| Baseline M32 | Spec **70/70**, cinq sondes, `test/child-process.mjs` réussi, `test-tools` **27/27**, Node FS vert. |
| `node tools/check-docs.mjs` | Vert après ajout de la carte et du plan v4. |
| Code exécutable | Aucune modification dans `src`, `test`, `tools` ou les ports. |
| `git diff --check` | Propre. |

Preuves : les logs M32 `spec-final-clean.log`, `test-tools-m32-final.log`,
`child-final.log` et `fs-m32-final.log` dans
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m25/`,
et le log `check-docs` du 21 octobre 2026.

**Conclusion : M41 validé. La cartographie et la baseline sont établies ; aucun
changement de comportement.**

## Validation M42

### Cas spéciaux et lisibilité du compilateur — 21 octobre 2026

PBO `Undefined` n’est plus encodé par un commentaire textuel. `JavaAst` possède
un nœud `JavaUndefined`, rendu `null` par le printer et traité sans captures par
le chunker. `CodeGen.Expr` l’utilise pour `PrimUndefined`; `Raw.isClosedValue`
ne reconnaît plus de préfixe `null /* TODO:`. Le test de portées vérifie le
rendu structurel et conserve un cas de commentaire fermé suivi d’une capture.

Les responsabilités de `CodeGen.Expr`, `Printer.Body`, `Chunk` et
`Ownership.Workers` ont été documentées aux frontières concernées. Aucun
découpage de module n’a été imposé sans duplication ou test à l’appui.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `spago build -q` | Vert. |
| `node test/ast-scopes.mjs` | Vert ; `JavaUndefined` rendu `null`, commentaire brut toujours opaque. |
| `node test/representations.mjs` | Vert. |
| `node test/codegen.mjs` | Vert. |
| `node test/driver.mjs` | Vert ; compilation, génération, `javac` et JVM. |
| `node test/typed-records.mjs` | Vert. |
| `rg 'TODO|FIXME|HACK|XXX' src test tools` | Aucun marqueur dans le code. |
| `node tools/check-docs.mjs` | Vert. |

**Conclusion : M42 validé. Le sentinel Undefined est structurel et le backend
reste sans marqueur TODO dans son code.**

## Validation M43

### Contrats runtime et FFI — 21 octobre 2026

Les conventions partagées par les ports Java sont maintenant regroupées dans
[les contrats FFI](ffi-runtime.md#contrats-communs-des-ports-java-m03) :
absence `undefined`/`null`, Buffers, événements, streams, callbacks FS async,
cycle de vie Net/HTTP et limites `ChildProcess`.

Le choix de conserver des helpers locaux est explicite : les classes internes
`__M$...` sont générées dans le module consommateur et une bibliothèque Java
commune ajouterait une dépendance entre ports. La duplication restante est donc
documentée plutôt que masquée.

`node-child-process` ne retourne plus de stub silencieux pour les API absentes :
chaque opération non implémentée (`exec`, `execFile`, `spawnSync`, IPC, `send`,
`channel`) lève une `UnsupportedOperationException` nommant le port et l’API.
Les propriétés `spawnFile`, `spawnArgs` et `stdio` sont renseignées à partir du
processus réel.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node test/child-process.mjs` | Réussi : spawn, stdout, exit tardif, métadonnées et erreur explicite `exec`. |
| `javapurs-node-event-emitter/bin/test` | Code 0, cinq sondes. |
| `javapurs-node-streams/bin/test` | Code 0, protocole synchrone et marqueur commun. |
| `javapurs-node-fs/bin/test` | Code 0, `all good` et marqueur commun. |
| `javapurs-node-net/bin/test` | Code 0, marqueur commun. |
| `javapurs-node-http/bin/test` | Code 0, marqueur commun. |
| `node tools/check-docs.mjs` | Vert après ajout des contrats. |
| `git diff --check` | Propre. |

**Conclusion : M43 validé. Les contrats FFI sont lisibles, les stubs restants
sont explicites et les six suites concernées passent.**

## Validation M44

### Harnais de tests lisible — 21 octobre 2026

Le registre des ports est désormais séparé du moteur d’exécution. Les profils
`awaited`, `synchronous`, `spec`, `wrappedSynchronous` et `specFull` vivent dans
`tools/port-profiles.mjs`. Le champ `assertion` (`spec` ou `ok`) remplace les
listes de wrappers dans les assertions de fin et les sondes.

La construction du sandbox de `test/test-tools.mjs` est déplacée dans
`test/support/tool-fixtures.mjs` : faux compilateur, ports historiques, commandes
et traces. Le fichier d’assertions conserve uniquement les scénarios et les
vérifications.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node --test test/test-tools.mjs` | **27/27 tests**. |
| `../javapurs-spec/bin/test` | **70 checks**, cinq sondes. |
| `javapurs-node-fs/bin/test` | Code 0. |
| `javapurs-node-net/bin/test` | Code 0. |
| `javapurs-node-http/bin/test` | Code 0. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M44 validé. Le harnais est découpé par responsabilité et les
profils sont des données nommées, sans perte de couverture.**

## Validation M45

### Documentation, hygiène et clôture — 21 octobre 2026

Le guide opérationnel a été séparé de l’historique :

- [Démarrer et valider](start-here.md) donne les prérequis, le build, les
  commandes ciblées et les liens de lecture ;
- les récits M01–M32 sont dans [l’historique des validations](validation-history.md) ;
- `testing.md` conserve les ancres `#validation-mXX` sous
  [Validations historiques](testing.md#validations-historiques) ;
- les lots du plan v4 sont renumérotés M41–M45 pour éviter la collision avec
  les validations historiques M01–M11.

Les liens README, maintien, compilateur et plans ont été alignés. Aucun
`TODO`/`FIXME` ne reste dans `src`, `test` ou `tools`.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node --test test/test-tools.mjs` | **27/27**. |
| `../javapurs-spec/bin/test` | **70 checks**, cinq sondes. |
| `node test/child-process.mjs` | Réussi. |
| `node tools/check-docs.mjs` | Vert après réorganisation. |
| `git diff --check` | Propre. |

**Conclusion : M45 validé. Le plan v4 est clôturé à 100/100 ; le guide reste
court et les preuves historiques restent accessibles.**

## Validation M51

### Launchers et configurations — 21 octobre 2026

Les 48 ports standards utilisent désormais le même launcher de cinq lignes :
le nom du port est déduit du dossier et le dispatcher commun est appelé avec
`--port=...`. Les launchers historiques ne divergent plus par port.

Les 7 ports sans launcher sont classés auxiliaires dans
[port-launchers](port-launchers.md#contrat-commun-et-configurations) :
`argonaut-core`, `control`, `js-bigints`, `js-uri`, `node-child-process`,
`spec-discovery` et `unsafe-reference`. `node-child-process` reste couvert par
`test/child-process.mjs` ; `spec-discovery` est une configuration sans suite
exécutable.

`tools/check-port-configs.mjs` vérifie sans build :

- la présence des 48 profils standards et de leurs launchers ;
- les 7 ports auxiliaires et leur configuration ;
- les noms de package et le package set `77.7.0` des ports standards ;
- les 2 376 chemins locaux déclarés dans les configurations Spago.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node tools/check-port-configs.mjs` | 48 standards, 7 auxiliaires, 2 376 chemins. |
| `node --test test/test-tools.mjs` | **27/27**. |
| `javapurs-node-fs/bin/test` | Code 0. |
| `javapurs-node-net/bin/test` | Code 0. |
| `javapurs-node-http/bin/test` | Code 0. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M51 validé. Un seul modèle de launcher, aucune ambiguïté sur les
ports auxiliaires, configurations contrôlées.**

## Validation M52

### Dette FFI résiduelle — 21 octobre 2026

Les deux marqueurs `TODO: PrimUndefined` de `partial` et `strings-extra` sont
supprimés : le contrat est désormais un commentaire explicite du sentinel PBO,
rendu en `null` Java.

`strings-extra` ne contient plus de shims Java locaux pour ses dépendances :
`Data.Array`, `Prelude`, `Partial`, `Strings`, `Console` et `Assert` viennent
des ports déclarés. Cela supprime **20 fichiers** dont `Data/Array.java`, qui
contenait de nombreux `FFI_STUB` et des méthodes retournant `null`.

`Node.FS.Stats` documente explicitement son fallback non-POSIX : les bits de
permission restent nuls lorsque `getPosixFilePermissions` n’est pas disponible.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `javapurs-partial/bin/test` | Code 0. |
| `javapurs-strings-extra/bin/test` | Code 0. |
| `javapurs-node-fs/bin/test` | Code 0. |
| Recherche `FFI_STUB`/`TODO` dans les ports | Aucun. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M52 validé. Les ports n’ont plus de stubs silencieux ni de
marqueurs TODO ; les dépendances FFI sont résolues par les ports réels.**

## Validation M53

### Fixtures Java partagées — 21 octobre 2026

`test/support/java-fixture.mjs` centralise le cycle commun des suites directes :
matérialisation des sources, appel `javac`, puis lancement de la classe
principale avec les options JVM. Les assertions, les noms de classes et les
helpers de boucle/records restent dans leurs suites.

Trois suites ont été migrées sans changement de comportement :

- `counted-loops.mjs` : **51** cas de sélection/rejet ;
- `loop-invariants.mjs` : **50** contrôles de cache ;
- `typed-records.mjs` : **75** contrôles runtime.

Aucun helper de boucle ou de record n’a été fusionné entre suites lorsque son
contrat sémantique différait ; seule la mécanique de compilation/exécution est
partagée.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node test/counted-loops.mjs` | Vert, 51 cas. |
| `node test/loop-invariants.mjs` | Vert, 50 contrôles. |
| `node test/typed-records.mjs` | Vert, 75 contrôles. |
| `node --test test/test-tools.mjs` | **27/27**. |
| `../javapurs-spec/bin/test` | **70 checks**, cinq sondes. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M53 validé. Les fixtures Java partagent leur cycle de vie, sans
perte d’assertions ni de couverture.**

## Validation M54

### Frontières de `Chunk` — 21 octobre 2026

Le chunker est découpé sans modifier la décision d’admission ni le Java produit :

- `Chunk/Types.purs` : état, `Chunk` et formes de résultat ;
- `Chunk/Value.purs` : construction des valeurs, captures et snapshots ;
- `Chunk/Helpers.purs` : groupes de tableaux fermés, remplissage et matérialisation ;
- `Chunk.purs` : traversée récursive et orchestration, **331 lignes** contre 388.

Les helpers de coût, captures et extraction restent dans leurs modules existants.
Aucun choix d’optimisation n’a été déplacé ou modifié.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node test/chunk.mjs` | **15 fixtures** vertes. |
| `node test/codegen.mjs` | **48/48** contrôles JVM par mode. |
| `node test/driver.mjs` | Vert après régénération complète des sorties PBO. |
| `node test/typed-records.mjs` | **75** contrôles runtime. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

Le build complet a été nécessaire pour aligner les sorties `output/PureScript.Backend.Optimizer.*` suivies avec la source PBO locale ; le driver a ensuite
retrouvé `toBackendModuleWithLookups`.

**Conclusion : M54 validé. Les frontières de `Chunk` sont explicites et le
comportement Java reste couvert.**

## Validation M55

### Reproductibilité et clôture — 21 octobre 2026

Les sorties générées suivies ont été vérifiées par double build :

1. hash de tous les `output/**/*.js` et `*.js.map` ;
2. `./bin/build` ;
3. hash après build ;
4. comparaison sans différence.

Les 48 launchers utilisent le même dispatcher, les 7 ports auxiliaires sont
documentés et `check-port-configs` valide 2 376 chemins locaux. Le guide
`start-here`, la carte, la maintenance, le README et la matrice sont à jour.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node --test test/test-tools.mjs` | **27/27**. |
| `../javapurs-spec/bin/test` | **70 checks**, cinq sondes. |
| `node test/child-process.mjs` | Réussi. |
| `node tools/check-port-configs.mjs` | 48 standards, 7 auxiliaires, 2 376 chemins. |
| `node tools/check-docs.mjs` | **743 liens**, 68 documents. |
| Hashes `output/**/*.js(.map)` avant/après build | Identiques. |
| `git diff --check` | Propre. |

**Conclusion : M55 validé. Le plan v5 est clôturé à 100/100 ; le dépôt est
documenté, reproductible et sans dette de configuration non contrôlée.**

## Validation M61

### Frontières de `CodeGen.Expr` — 21 octobre 2026

`CodeGen.Helpers` isole les décisions pures qui ne participent pas au
dispatcher récursif : cible de queue, arité boxed, locaux/globaux, littéraux,
champs, accesseurs et assemblage des branches. `CodeGen.Expr` conserve la
traduction récursive, les appels, les effets et les boucles.

`CodeGen.Expr` passe de **371 à 279 lignes** ; `CodeGen.Helpers` en fait 118.
Aucune décision de représentation, d’effet ou d’optimisation n’a été déplacée.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node test/chunk.mjs` | **15 fixtures**. |
| `node test/codegen.mjs` | **48/48** contrôles JVM par mode. |
| `node test/driver.mjs` | Vert. |
| `node test/typed-records.mjs` | **75** contrôles. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M61 validé. La frontière des helpers est explicite et les sorties
Java restent couvertes.**

## Validation M62

### Source unique des configurations Spago — 21 octobre 2026

`tools/port-configs.mjs` porte la liste des 48 packages locaux communs et les
extras `js-bigints`/`node-child-process`. Il peut vérifier les blocs
`extraPackages` (`--check`) ou les canonicaliser (`--write`) sans toucher aux
dépendances, au package set ni aux options propres à chaque port.

La canonicalisation n’a modifié que **Spec** et **Yoga**, qui avaient un ordre
d’extras différent. Les 48 autres configurations étaient déjà canoniques.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node tools/port-configs.mjs --check` | 49 configurations canoniques. |
| `node tools/port-configs.mjs --write` | 2 fichiers réordonnés, puis idempotent. |
| `node tools/check-port-configs.mjs` | 48 standards, 7 auxiliaires, 2 376 chemins. |
| `javapurs-spec/bin/test` | **70 checks**, cinq sondes. |
| `javapurs-yoga-json/bin/test` | **52/52**, cinq sondes. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M62 validé. Les configurations partagent une source de vérité
contrôlée et restent valides sur les ports réels.**

## Validation M63

### Fixtures Java restantes — 21 octobre 2026

`test/support/java-fixture.mjs` accepte maintenant un répertoire de classes et
un classpath distincts, en plus des options `javac`/JVM déjà partagées.

Quatre suites supplémentaires sont migrées sans changement d’assertions :

- `ast-scopes.mjs` : **110** contrôles runtime dans les modes renamed/chunked ;
- `chunk.mjs` : **15** fixtures ;
- `codegen.mjs` : **48/48** contrôles par mode ;
- `constructor-reuse.mjs` : **7** groupes de fixtures.

Les helpers métier restent dans chaque suite ; seule la mécanique de
compilation/exécution est centralisée.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node test/ast-scopes.mjs` | 110 + 110 contrôles. |
| `node test/chunk.mjs` | 15 fixtures. |
| `node test/codegen.mjs` | 48/48 par mode. |
| `node test/constructor-reuse.mjs` | 7 groupes. |
| `node --test test/test-tools.mjs` | **27/27**. |
| `../javapurs-spec/bin/test` | **70 checks**. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M63 validé. Sept suites utilisent désormais le même cycle de
fixture Java, sans perte de couverture.**

## Validation M64

### Ports auxiliaires et sorties — 22 octobre 2026

Le statut des 7 ports sans launcher est désormais explicite :

- cinq dépendances transitives (`argonaut-core`, `control`, `js-bigints`,
  `js-uri`, `unsafe-reference`) n’ont pas de suite directe ;
- `node-child-process` garde `spago.yaml`, mais sa validation est
  `test/child-process.mjs` ; il n’a pas de `spago.java.yaml` ni de suite Spago ;
- `spec-discovery` est une configuration consommée par les suites Spec, sans
  launcher.

`tools/check-generated.mjs` exécute un build complet, puis compare les hashes
SHA-256 des sorties JavaScript/source maps suivies avant et après.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node tools/check-generated.mjs` | **1 028 fichiers stables**. |
| `node tools/check-port-configs.mjs` | 48 standards, 7 auxiliaires, 2 376 chemins. |
| `node --test test/test-tools.mjs` | **27/27** (M63). |
| `../javapurs-spec/bin/test` | **70 checks** (M63). |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M64 validé. Les auxiliaires ont un statut sans ambiguïté et les
sorties générées sont contrôlées automatiquement.**

## Validation M65

### Documentation et clôture — 22 octobre 2026

Le plan v5 est archivé, la carte et le guide `start-here` sont à jour, et les
commandes de contrôle des ports et des sorties sont documentées. Le plan v6 est
fermé sans workspace temporaire ni sortie générée non expliquée.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node --test test/test-tools.mjs` | **27/27**. |
| `../javapurs-spec/bin/test` | **70 checks**, cinq sondes. |
| `node test/child-process.mjs` | Réussi. |
| `node tools/check-port-configs.mjs` | 48 standards, 7 auxiliaires, 2 376 chemins. |
| `node tools/port-configs.mjs --check` | 49 configurations canoniques. |
| `node tools/check-generated.mjs` | **1 028 fichiers stables**. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M65 validé. Le plan v6 est clôturé à 100/100 ; le dépôt est
canonique, testé et documenté.**

## Validation M71

### Vérité documentaire — 22 octobre 2026

Les statuts actifs ont été réalignés sur les validations v6 :

- README pointe vers les archives `plan-v4`, `plan-v5` et `plan-v6`, et vers
  le plan v7 actif ;
- Spec est décrit comme **70/70** (62 purs + 8 intégrations), sans exclusion
  `npx`/`spec-node` ;
- `testing.md` ne parle plus de « six protocoles non pris en charge » ;
- `port-launchers.md` distingue l’inventaire historique M23 des 48 profils
  actuels et des 7 ports auxiliaires ;
- Node FS et Spec ne sont plus décrits avec leurs anciens statuts rejetés.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node tools/check-docs.mjs` | **767 liens/ancres**, 70 documents. |
| Recherche des statuts obsolètes | Aucun statut actif contredit les validations. |
| `git diff --check` | Propre. |

**Conclusion : M71 validé. La documentation décrit l’état v6 et le plan v7,
sans réintroduire les exclusions historiques.**

## Validation M72

### Fixtures Java restantes — 22 octobre 2026

`java-fixture` accepte désormais les arguments passés au programme Java. Quatre
suites supplémentaires utilisent le cycle commun :

- `direct-calls.mjs` : **40** contrôles par mode ;
- `printer.mjs` : **75 + 11** contrôles ;
- `ownership-loops.mjs` : **9** contrôles par mode ;
- `representations.mjs` : **43** contrôles dans chacun des huit modes.

Onze suites au total partagent maintenant la préparation Java. Les helpers de
construction d’AST, de boucles et de records restent dans leurs suites.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node test/direct-calls.mjs` | 40 + 40 contrôles. |
| `node test/printer.mjs` | 75 + 11 contrôles. |
| `node test/ownership-loops.mjs` | 9 + 9 contrôles. |
| `node test/representations.mjs` | 8 modes × 43 contrôles. |
| `node --test test/test-tools.mjs` | **27/27**. |
| `../javapurs-spec/bin/test` | **70 checks**, cinq sondes. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M72 validé. Onze suites utilisent le même cycle Java, sans perte
d’assertions ni de couverture.**

## Validation M73

### Validation unifiée — 22 octobre 2026

`tools/check-all.mjs` agrège les contrôles avec logs par phase :

- `--quick` : `check-docs`, `check-port-configs`, canonicalisation des
  configurations et `check-generated` ;
- `--full` : ajoute `test-tools`, `child-process`, Spec et Node FS.

Les options sont strictes ; aucun `|| true` ne masque un échec. Les logs sont
écrits sous `logs/check-all/` (ignoré par Git).

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node tools/check-all.mjs --quick` | Vert ; 4 phases. |
| `node tools/check-all.mjs --full` | Vert ; 8 phases. |
| Logs | `logs/check-all/{docs,port-configs,port-configs-canonical,generated,test-tools,child-process,spec,node-fs}.log`. |
| `node tools/check-docs.mjs` | Vert. |
| `git diff --check` | Propre. |

**Conclusion : M73 validé. La clôture ciblée tient dans une commande unique,
avec logs reproductibles et sans masquage d’échec.**

## Validation M74

### Matrice FFI des ports — 22 octobre 2026

[docs/port-ffi.md](port-ffi.md) relie chaque port à son profil, ses fichiers
Java FFI et ses limites. Les ports auxiliaires sont inclus séparément, avec
`node-child-process` et `spec-discovery` documentés hors suite Spago standard.

`tools/check-port-ffi.mjs` compare la matrice aux fichiers Java réellement
présents : lignes manquantes, doublons, chemins absents et fichiers non listés
échouent. `check-all --quick` exécute ce contrôle après la canonicalisation des
configurations.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node tools/check-port-ffi.mjs` | 48 standards, 7 auxiliaires, **118 fichiers Java** cohérents. |
| `node tools/check-all.mjs --quick` | 5 phases vertes. |
| `node tools/check-docs.mjs` | **774 liens/ancres**, 71 documents. |
| `git diff --check` | Propre. |

**Conclusion : M74 validé. La surface FFI de chaque port est inventoriée et
vérifiée automatiquement.**

## Validation M75

### Clôture du plan v7 — 22 octobre 2026

La documentation, la matrice FFI, les configurations et les sorties générées
sont alignées. Le profil complet `check-all --full` exécute les 9 phases et
conserve un log par phase sous `logs/check-all/`.

### Résultats ciblés

| Vérification | Résultat |
| --- | --- |
| `node tools/check-all.mjs --full` | **9 phases vertes**. |
| `docs` | 776 liens/ancres, 71 documents. |
| `port-ffi` | 48 standards, 7 auxiliaires, 118 fichiers Java. |
| `generated` | 1 028 fichiers JS/source maps stables. |
| `test-tools` | **27/27**. |
| Spec | **70 checks**, cinq sondes. |
| `child-process` / Node FS | Réussis. |
| `todo.md` | Aucune case ouverte. |

**Conclusion : M75 validé. Le plan v7 est clôturé à 100/100 ; le dépôt est
documenté, vérifié et reproductible.**
