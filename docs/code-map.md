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

Le compilateur est un outil Node : `bin/build` construit ses modules JavaScript,
puis `bin/javapurs` les charge. Le backend lit le TAST enrichi d’une
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
| `CodeGen.Expr` / `CodeGen.Helpers` / `CodeGen.Context` / `CodeGen.Syntax` | Traduction récursive, helpers purs (calls/locaux/littéraux/accesseurs), environnement lexical et contrats de syntaxe. | `docs/expressions.md` |
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
| `test/support/java-fixture.mjs` | Cycle commun des fixtures Java : sources, `javac`, classes de sortie, arguments et lancement JVM. |
| `test/test-tools.mjs` | Tests du runner, des profils, des launchers et de la conservation des workspaces. |
| `tools/fixture-runner.mjs` | Préparation des workspaces de fixtures et exécution des phases. |
| `tools/test-workspace.mjs` | Cycle de vie des répertoires temporaires et logs. |
| `tools/test-process.mjs` | Sous-processus bornés, signaux, erreurs et traces. |
| `tools/port-profiles.mjs` | Données des profils de ports et protocole d’assertion (`spec`/`ok`). |
| `tools/port-configs.mjs` | Source des 48 packages locaux communs ; `--check`/`--write` des blocs `extraPackages`. |
| `tools/check-generated.mjs` | Reconstruction et stabilité SHA-256 des sorties JS/source maps suivies. |
| `tools/check-all.mjs` | Validation agrégée `--quick`/`--full`, logs par phase. |
| `tools/check-port-ffi.mjs` | Vérifie la matrice `docs/port-ffi.md` contre les fichiers Java réels. |
| `tools/port-test-runner.mjs` | Phases de génération, `javac`, exécution et probes ; consomme le registre de profils. |
| `test/support/tool-fixtures.mjs` | Construction du sandbox de `test-tools` : faux compilateur, ports et commandes. |
| `tests/port-suites/*.purs` | Wrappers `Test.PortRunner` pour les suites qui attendent une action Aff. |
| `tests/runner/` | Workspace PureScript des fixtures compilées par le backend. |
| `bin/test`, `bin/modtest`, `bin/build`, `bin/javapurs` | Lancement utilisateur et build du compilateur. |

Le runner de ports décrit chaque port par un profil (`synchronous`, `awaited`,
`spec`, `Fs`, `Net`, `Http`, `SpecFull`). Le port `javapurs-node-child-process`
fait partie des sept ports auxiliaires et possède une suite dédiée dans le
compilateur. Les 48 ports standards possèdent un launcher `bin/test`.

## Ports et artefacts

- Un port vit dans un checkout voisin `javapurs-<nom>/` et possède généralement
  `src/` (PureScript + Java FFI), `test/`, `spago.java.yaml` et `bin/test`.
- Les 48 `bin/test` délèguent au runner commun ; les profils et les sources sont
  décrits dans `tools/port-profiles.mjs`, puis exécutés par
  `tools/port-test-runner.mjs`.
- `spago.java.yaml` porte les dépendances et les chemins locaux ; les modules
  Java doivent rester adjacents aux modules PureScript qu’ils implémentent.
- Les sorties applicatives sont `output/<Module>/corefn.json`,
  `.purmeta/<Module>.purmeta` et `output/java/`. Les classes compilées vont dans
  le répertoire choisi par `javac -d` ; le backend ne les possède pas.
- Les runners écrivent leurs logs sous `logs/` et annoncent les workspaces
  temporaires conservés à l’échec. Leur [politique de conservation](maintenance.md#journaux-et-preuves)
  distingue ces données locales des sources et validations versionnées.

## Baseline M41 — 21 octobre 2026

[Mesures historiques conservées dans le plan v4](plan-v4.md#baseline-m41--21-octobre-2026).

## Dette priorisée pour le plan v4

[Inventaire historique et clôtures](plan-v4.md#dette-priorisée-pour-le-plan-v4).

## Parcours de lecture recommandé

1. Lire [le guide du compilateur](compiler.md#suivre-une-compilation) pour le
   flux `Main` → `Driver` → `Pipeline` → `Emit`.
2. Lire cette carte pour choisir le module et le contrat concernés.
3. Lire [les représentations](representations.md) ou [le chunking](chunking.md)
   avant de modifier les passes spécialisées.
4. Lire [le guide de test](testing.md#matrice-des-tests) et `test/child-process.mjs`
   pour reproduire une validation ciblée.
5. Consulter [les limites et points ouverts](maintenance.md#points-ouverts-après-le-plan)
   avant de choisir une extension.
