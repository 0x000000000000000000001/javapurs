# Carte du code Javapurs

Carte de lecture pour les humains. Elle décrit les responsabilités et le flux
des données, pas les détails d’implémentation. Le [guide du compilateur](compiler.md)
reste la référence pédagogique ; cette page sert de point d’entrée pour le
cleanup et la navigation quotidienne.

## Vue en trente secondes

```text
src/Main.purs
  └─ Config.parseArgs
      └─ Driver.compile
          ├─ Input.readModules             corefn.json enrichi
          ├─ PBO.buildModules              analyse, optimisation, TAST
          ├─ Pipeline.lowerModule
          │   ├─ CodeGen                   TAST → JavaAst
          │   ├─ Rename                    noms lexicaux uniques
          │   └─ Chunk                     helpers __chunk$N bornés
          └─ Emit / Output                 runtime, modules, manifeste
              └─ Printer                   JavaAst → texte Java
```

Le compilateur est un outil Node : `bin/javapurs` construit/charge les modules
JavaScript du compilateur, puis le backend lit le TAST enrichi d’une
application et publie du Java sous `output/java/`.

## Compilateur

| Module | Responsabilité | À lire avec |
| --- | --- | --- |
| `src/Main.purs` | Entrée du processus, erreurs et code de sortie. | `Config`, `Driver` |
| `Javapurs.Config` | Options CLI et types de configuration du pipeline. | `docs/compiler.md` |
| `Javapurs.Driver` | Orchestration : chargement, validation du `main`, PBO, FFI et émission. | `docs/compiler.md` |
| `Javapurs.Input` | Lecture et tri des modules TAST `corefn.json`. | `docs/compiler.md` |
| `Javapurs.Pipeline` | Frontière de production après PBO ; ordre `CodeGen` → `Rename` → `Chunk`. | `docs/chunking.md` |
| `Javapurs.CodeGen` | Assemblage d’un module Java, types, workers et passes post-traduction. | `docs/compiler.md` |
| `CodeGen.Expr` / `CodeGen.Context` / `CodeGen.Syntax` | Traduction récursive des expressions, environnement lexical et contrats de syntaxe. | `docs/expressions.md` |
| `Javapurs.JavaAst` | IR Java mixte : valeurs, statements, déclarations et sélecteurs. | `docs/ast.md` |
| `Javapurs.Rename` | Unicité des liaisons avant chunking. | `docs/chunking.md` |
| `Javapurs.Chunk` / `Chunk.Types` / `Chunk.Value` / `Chunk.Helpers` / `Chunk.Captures` / `Chunk.Extraction` | Découpage des expressions, état/result shapes, valeurs, groupes de tableaux, captures et admission par coût. | `docs/chunking.md` |
| `Javapurs.Ownership` / `Ownership.*` | Workers consommateurs, cellules et preuves d’usage. | `docs/specialized-passes.md` |
| `Javapurs.Representation` / `TypeEvidence` | Choix de stockage et preuves de types après PBO. | `docs/representations.md` |
| `Javapurs.DirectCalls` / `Reuse` / `LoopInvariants` / `IntLoops` | Passes ciblées de simplification et de spécialisation. | `docs/specialized-passes.md` |
| `Javapurs.JavaAst` → `Printer` / `Printer.Body` / `Printer.Declarations` | Rendu structurel du Java. | `docs/printing.md` |
| `Javapurs.RecordShapes` / `RecordPrinter` / `RecordTypes` | Classes de records typés et propagation des annotations. | `docs/representations.md` |
| `Javapurs.Runtime` / `Emit` | Templates partagés (`__IntFn`, `TcoLoop`, `MainRun`) et écriture des modules. | `docs/printing.md` |
| `Javapurs.Output` | Transaction de publication : staging, inventaire, rollback. | `docs/maintenance.md` |
| `Javapurs.Ffi` / `Diagnostics` / `Metrics` | Rapports FFI, contexte d’erreur et mesures de phases. | `docs/ffi-runtime.md` |

### Frontières à préserver

- **PBO reste le propriétaire du TAST optimisé** ; le pipeline Java ne réinfère
  pas les types et ne défait pas les décisions d’optimisation.
- **`Rename` précède `Chunk`** : les captures de chunking dépendent des noms
  lexicaux uniques.
- **`JavaAst` est la représentation structurelle** ; `JavaRaw` est une exception
  documentée, pas un moyen de contourner le printer.
- **`Output` possède la transaction fichiers** ; `Emit` assemble le texte mais
  ne publie pas directement.
- **Le launcher Node est un artefact actif** : `output/` du compilateur diffère
  des sorties Java d’une application.

## Tests et harnais

| Point d’entrée | Rôle |
| --- | --- |
| `test/*.mjs` | Suites directes Node avec fixtures Java/PureScript, organisées par capacité. |
| `test/driver.mjs` | Compilation d’un module de test, génération, `javac` et exécution. |
| `test/child-process.mjs` | Probe FFI `node-child-process` : spawn, stdout, exit tardif. |
| `test/support/java-fixture.mjs` | Cycle commun des fixtures Java : sources, `javac`, lancement JVM. |
| `test/test-tools.mjs` | Tests du runner, des profils, des launchers et de la conservation des workspaces. |
| `tools/fixture-runner.mjs` | Préparation des workspaces de fixtures et exécution des phases. |
| `tools/test-workspace.mjs` | Cycle de vie des répertoires temporaires et logs. |
| `tools/test-process.mjs` | Sous-processus bornés, signaux, erreurs et traces. |
| `tools/port-profiles.mjs` | Données des profils de ports et protocole d’assertion (`spec`/`ok`). |
| `tools/port-test-runner.mjs` | Phases de génération, `javac`, exécution et probes ; consomme le registre de profils. |
| `test/support/tool-fixtures.mjs` | Construction du sandbox de `test-tools` : faux compilateur, ports et commandes. |
| `tests/port-suites/*.purs` | Wrappers `Test.PortRunner` pour les suites qui attendent une action Aff. |
| `tests/runner/` | Workspace PureScript des fixtures compilées par le backend. |
| `bin/test`, `bin/run`, `bin/build`, `bin/javapurs` | Lancement utilisateur et build du compilateur. |

Le runner de ports décrit chaque port par un profil (`synchronous`, `awaited`,
`spec`, `Fs`, `Net`, `Http`, `SpecFull`). Le port `javapurs-node-child-process`
ajoute une FFI Java et un test dédié, mais ne fait pas encore partie des 49
launchers historiques.

## Ports et artefacts

- Un port vit dans un checkout voisin `javapurs-<nom>/` et possède généralement
  `src/` (PureScript + Java FFI), `test/`, `spago.java.yaml` et `bin/test`.
- Les 49 `bin/test` délèguent au runner commun ; les profils et les sources sont
  décrits dans `tools/port-test-runner.mjs`.
- `spago.java.yaml` porte les dépendances et les chemins locaux ; les modules
  Java doivent rester adjacents aux modules PureScript qu’ils implémentent.
- Les sorties applicatives sont `output/<Module>/corefn.json`,
  `.purmeta/<Module>.purmeta` et `output/java/`. Les classes compilées vont dans
  le répertoire choisi par `javac -d` ; le backend ne les possède pas.
- Les preuves de validation et les workspaces conservés vont dans
  `/private/var/folders/.../opencode/javapurs-m25/` sur cette machine ; ils ne
  sont pas des entrées de build.

## Baseline M41 — 21 octobre 2026

Mesures statiques, reproductibles avec `wc`, `find` et `grep` :

| Mesure | Valeur |
| --- | ---: |
| Lignes PureScript du compilateur (`src/**/*.purs`) | 5 355 |
| Fichiers Java FFI de ports (`javapurs-*/src/**/*.java`) | 139 |
| Lignes Java FFI de ports | 8 643 |
| Ports standards avec `src/`, `test/`, `bin/test`, `spago.java.yaml` | 48 (+7 auxiliaires) |
| Suites directes listées par la matrice | 30 |
| `docs/testing.md` | 3 556 lignes |
| `test/test-tools.mjs` + `test/support/tool-fixtures.mjs` | 551 + 150 lignes après M44 (677 à l’ouverture) |
| `TODO`/`FIXME`/`HACK`/`XXX` dans `src`, `test`, `tools` | 0 après M42 (3 à l’ouverture) |

Les validations de départ restent celles de M32 : Spec **70/70**, cinq sondes,
`test/child-process.mjs` réussi, `test-tools` **27/27**, Node FS vert et
`check-docs` **684 liens** au moment de l’ouverture. Les logs de référence sont
`spec-final-clean.log`, `test-tools-m32-final.log`, `child-final.log` et
`fs-m32-final.log` dans le dossier de preuves M32.

## Dette priorisée pour le plan v4

| Priorité | Point de friction | Preuve | Lot |
| ---: | --- | --- | --- |
| 1 | **Résolu M42** : `PrimUndefined` est un nœud `JavaUndefined` ; `Raw` ne reconnaît plus de commentaire. | `JavaAst`, `Printer`, `CodeGen/Expr`, `Raw`, `test/ast-scopes.mjs` | M42 |
| 2 | Les deux plus gros modules ont été revus et documentés en M42 ; leur découpage n’est pas nécessaire sans preuve de duplication. | `Chunk.purs` 386 lignes, `CodeGen/Expr.purs` 367 | M42 |
| 3 | **Séparé M44** : fixtures dans `test/support/tool-fixtures.mjs`, assertions et inventaire dans `test/test-tools.mjs`. | 551 + 150 lignes | M44 |
| 4 | **Centralisé M44** : profils et `assertion` sont des données dans `tools/port-profiles.mjs` ; le runner ne liste plus les wrappers. | `tools/port-profiles.mjs` | M44 |
| 5 | Les 49 launchers de ports répètent la même séquence de build et de publication. | 49 `bin/test` | M44 |
| 6 | Les 49 `spago.java.yaml` répètent les dépendances et chemins locaux. | 49 fichiers de configuration | M43 |
| 7 | **Contracts documentés M43** : les helpers restent locaux aux ports, car leur ABI `__M$...` est générée par module ; les conventions Nullable, Buffer, événements, streams et erreurs sont centralisées dans `docs/ffi-runtime.md`. | 139 fichiers, 8 643 lignes | M43 |
| 8 | **Corrigé M43** : les stubs `node-child-process` nomment l’API et lèvent `UnsupportedOperationException("node-child-process: …")` ; `spawnFile`/`spawnArgs` sont réels. | `node-child-process` | M43 |
| 9 | `docs/testing.md` mélange guide opérationnel et récits de validation historiques. | 3 556 lignes | M45 |
| 10 | Les fixtures de capacités dupliquent encore des boucles et des helpers de test. | `test/*.mjs`, `test/support/` | M44 |

## Parcours de lecture recommandé

1. Lire [le guide du compilateur](compiler.md#suivre-une-compilation) pour le
   flux `Main` → `Driver` → `Pipeline` → `Emit`.
2. Lire cette carte pour choisir le module et le contrat concernés.
3. Lire [les représentations](representations.md) ou [le chunking](chunking.md)
   avant de modifier les passes spécialisées.
4. Lire [le guide de test](testing.md#matrice-des-tests) et `test/child-process.mjs`
   pour reproduire une validation ciblée.
5. Consulter [le plan v5](../todo.md) pour le lot et le critère de clôture.
