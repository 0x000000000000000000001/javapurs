# Tests ciblés et registre de validation

État documenté au **1er octobre 2026**. Les commandes de cette page s'exécutent
depuis le dépôt du compilateur `htdocs/javapurs/javapurs`, sauf indication contraire.

## Choisir le bon niveau

| Niveau | Entrée et résultat vérifié |
| --- | --- |
| Suites directes `test/*.mjs` | Modules JavaScript construits du compilateur, AST synthétiques et, suivant le script, compilation/exécution de fixtures Java. |
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

Les suites Node/Java utilisent ces variables, avec un défaut Homebrew
`/opt/homebrew/opt/openjdk/bin`. `bin/test` préfère le PATH avant ce défaut.
Les scripts des ports Aff/Refs appellent directement `javac` et `java` sur le
PATH : leurs conventions restent propres au port.

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
| Grand arbre de branches | [test/big-function.mjs](../test/big-function.mjs) | 155 contrôles de `f` ; nécessite immédiatement avant lui un run réussi de `bin/test BigFunction`. |

Pour une modification de `JavaAst` ou de `Printer`, choisir les lignes qui
utilisent les nœuds modifiés et vérifier leurs parcours dans les passes
consommatrices. Pour `Main`, la CLI ou l'insertion FFI, préparer une fixture
nommée qui emprunte le chemin complet ; les scripts AST seuls ne couvrent pas
l'orchestration. Des fixtures CLI dédiées font partie des lots M02/M03.

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

[bin/test](../bin/test) lit en priorité le corpus du fork à
`../../purescript/tests/purs/passing`, avec un repli vers `tests/passing`.
Les ports nécessaires sont énumérés dans [bin/pkg](../bin/pkg).

```bash
./bin/test BigFunction DerivingTraversable --list
./bin/test DerivingTraversable
```

Le premier appel doit lister exactement les deux noms. Le second exécute une
seule fixture. Le runner accepte nom, nom avec `.purs` ou chemin de fichier.
Actuellement, un argument introuvable est affiché puis ignoré ; si aucun nom
ne reste, la sélection devient le corpus par défaut. Inspecter les noms avec
`--list` avant l'exécution. `--list` doit être utilisé sans `-c`, car ce dernier
reconstruit et nettoie avant la sortie de la liste.

Pour chaque fixture sélectionnée :

1. Une surcharge locale de même nom dans `tests/passing` prime sur le fichier du
   fork. Les modules auxiliaires du dossier associé sont copiés avec elle.
2. Le runner remplace `tests/runner/src`, `output`, `java_output` et `classes`.
3. Une FFI Java adjacente prime sur `tests/ffi/NOM.java` ; la FFI JavaScript
   adjacente, lorsqu'elle existe, satisfait la compilation PureScript.
4. Il appelle Spago, Javapurs, `javac`, puis `java -cp classes MainRun`.
5. Il compte les succès/échecs par phase. Le fichier `logs-NOM.txt` du runner est
   réutilisé entre phases et supprimé au succès ; conserver la sortie externe
   d'une investigation si son historique est nécessaire.

`--keep-going` poursuit la sélection après un échec. Les bornes `skip_before=`
et `until=` s'appliquent à la sélection ; `-c` reconstruit aussi le backend et
nettoie les caches du runner. Les exclusions actuelles sont `DerivingClause`,
`DerivingContravariant`, `DerivingFunctorFromBi`, `DerivingFunctorFromPro`,
`DerivingProfunctor` et `4179`, pour les raisons indiquées dans le script.

### Chunker et BigFunction

Séquence ciblée pour un changement des captures, scopes ou budgets :

```bash
./bin/build
node test/chunk.mjs
JAVA_TOOL_OPTIONS=-Xmx4g ./bin/test BigFunction
node test/big-function.mjs
./bin/test DerivingTraversable
```

Vérifier le succès de chaque commande avant la suivante. Le harness BigFunction
lit `tests/runner/src/Main.purs` et réutilise ses classes ; le test suivant les
remplacera. Son allocation d'entrée est bornée : les 51 tailles de motifs sont
exercées, 26 avec succès de toutes les gardes et les grandes tailles par leurs
chemins d'échec. Ce contrôle complète le `main` du corpus, qui couvre peu `f`.

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
