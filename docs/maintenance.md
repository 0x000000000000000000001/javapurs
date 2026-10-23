# Reprise et entretien du dépôt

Cette page indique où modifier un contrat, quels fichiers sont maintenus et
comment conserver les preuves utiles. Les plans v1–v7 sont clôturés ; leurs
résultats datés restent dans [l’historique](validation-history.md).
Le [dernier entretien](validation-history.md#entretien-du-23-octobre-2026)
consigne les nettoyages et vérifications du 23 octobre 2026.

## Parcours de reprise

1. Suivre [Démarrer et valider](start-here.md) pour sélectionner le fork TAST
   et le niveau de vérification ; utiliser [la carte du code](code-map.md)
   pour trouver le propriétaire de la modification.
2. Lire et modifier le contrat correspondant dans son guide de référence :

| Sujet | Référence |
| --- | --- |
| Pipeline, TAST, CLI et sorties Java | [Compilateur](compiler.md) |
| Nœuds, noms, captures et Java brut | [AST et portées](ast.md) |
| Extraction et budget des helpers | [Chunking](chunking.md) |
| Traduction et ordre d’évaluation | [Expressions](expressions.md) |
| Types, stockage et conventions d’appel | [Représentations](representations.md) |
| Admission et refus des optimisations | [Passes spécialisées](specialized-passes.md) |
| Corps Java et frontières Supplier | [Rendu](printing.md) |
| Exceptions, fibres, références et promesses | [FFI et runtimes](ffi-runtime.md) |
| Surface et limites de chaque port | [Matrice FFI](port-ffi.md) |
| Références source et livraison JAR | [Installation](installation.md) |
| Tests, JDK de build, cible et JVM | [Validation ciblée](testing.md) |

3. Exécuter les suites pertinentes de la [matrice](testing.md#matrice-des-tests).
   Après une modification de génération, comparer les sorties sur les mêmes
   TAST, options et FFI. Reconstruire après changement du backend ou de PBO.
4. Consigner les commandes, résultats et limites utiles, puis vérifier la
   cohérence documentaire et les espaces :

```sh
node tools/check-docs.mjs
git diff --check
```

`check-docs` utilise Node et Bash, sans build ni JDK. Il vérifie les liens et
ancres locales, la syntaxe des exemples shell, la matrice des suites, les options
CLI et le suivi documentaire. Les README des ports standards et ceux des
auxiliaires présents sont inclus. Le layout des checkouts voisins doit exister.
Le contrôle agrégé `check-all --quick`, lui, reconstruit le backend : voir ses
[prérequis](start-here.md#prérequis).

## Interfaces et replis relus

Les modules PureScript de `src/` exposent des listes explicites. Les façades ci-dessous
conservent des consommateurs et délèguent à une définition unique :

| Interface | Propriétaire / consommateur |
| --- | --- |
| `CodeGen.translate*` | Variantes d'options utilisées notamment par `typed-records.mjs`, `loop-invariants.mjs`, `direct-calls.mjs` et `int-functions.mjs`. L'entrée complète du pipeline reste `Pipeline.lowerModule`. |
| `CodeGen.extractUncurriedAbs` | Réexport de `CodeGen.Syntax`, utilisé par les fixtures de boucles et invariants. |
| `Printer.printFile` | Enveloppe sans FFI des suites AST ; `Emit` assemble les modules de production. |
| `Printer.escapeJavaString` | Réexport de `Printer.Syntax`, propriétaire de l'échappement. |
| `IntFunctions.runtimeSource` | Alias du template `Runtime.intFunctionSource`, utilisé par les suites et benchmarks existants. |
| `FunctionTypes.intFunction`, `CodeGen.Syntax.paramKinds` | Réexports des propriétaires `TypeEvidence` et `Representation`, conservés comme interfaces de compatibilité. |

Les parcours semblables gardent leurs contrats distincts : le parcours structurel
de `JavaAst`, les portées de `Rename`, les captures de `Chunk` et les frontières
de `ControlFlow` ne sont pas interchangeables. Les rendus communs et les projections
de types ont leur propriétaire nommé ; les exceptions de portée restent locales.

Les replis Maps/Object, appels curryfiés gardés, `TcoLoop`, refus d'extraction
opaque et workers persistants sont des chemins d'exécution testés. Le sentinel
Undefined de PBO est porté par le nœud structurel `JavaUndefined`, rendu en
`null` Java ; il ne dépend plus d'un commentaire `TODO` ni d'une reconnaissance
de texte dans `Raw.isClosedValue`.

## Statut des fichiers et des sorties

| Emplacement | Propriétaire et statut |
| --- | --- |
| `src/`, `tools/`, `bin/` | Sources maintenues. Les fichiers `.purs` courants sont la référence du backend. |
| `tools/source-lock.json`, `tools/install-source.mjs`, `examples/` | Références Git compatibles, export/reconstruction source isolée et exemples Hello/Refs. `installation.json`, logs, builds et JAR sont créés dans le workspace explicitement choisi. |
| `test/`, `tests/ffi-ports/`, `tests/port-suites/`, `tests/ffi/`, `tests/passing/` | Sources des régressions et surcharges. Les fixtures FFI/ports restent hors de `test/**/*.purs`, glob du build du backend. |
| `tests/runner/spago.yaml`, `spago.lock` | Configuration persistante du runner ; le YAML sert aussi aux workspaces isolés. |
| `output/` du compilateur | Modules JavaScript, FFI, source maps et `package.json` **suivis dans Git** ; `bin/javapurs.js` charge `output/Main/index.js`. Les métadonnées `corefn.json`, `docs.json`, `externs.cbor` et `cache-db.json` sont régénérables, retirées du checkout et ignorées. `./bin/build` reconstruit le tout après changement des sources ; `tools/check-generated.mjs` vérifie la stabilité SHA-256 des sorties JS/source maps. |
| `.spago/` | Dépendances et état Spago régénérables, désormais ignorés. Les copies locales, y compris les anciennes copies suivies du compilateur, ont été retirées lors du nettoyage après M18. |
| `.purs-repl` | Configuration persistante du REPL (`import Prelude`). |
| `.psci_modules/` | Ancien build REPL retiré lors du nettoyage demandé pendant M13 ; régénérable par le REPL et désormais ignoré. Le launcher du compilateur charge `output/`. |
| `.DS_Store`, `*.class`, `*.java.bak` | Métadonnées Finder, classes compilées isolées et sauvegardes Java ignorées. Les exemplaires identifiés ont été archivés puis retirés après M18. |
| `tests/runner/src`, `output` (dont `java/classes`), `.purmeta` | État remplaçable d'une fixture, ignoré par le `.gitignore` du runner. Son `spago.yaml` et ses sources d'origine restent persistants. |
| `output` (dont `java/classes`), `.purmeta` dans un port | Entrées TAST, Java/classes et caches d'optimisation régénérables. Les anciennes copies `output`/`java_output` des ports ont été archivées puis retirées après M18, avec leurs entrées suivies ; les règles Git couvrent leur régénération. |
| `.javapurs-manifest.json`, `.javapurs-work/` dans une sortie Java | Propriété/SHA-256 des sources et relevé de sélection `ffi` de la même génération ; staging, verrou PID et journal de récupération. Voir le [cycle de vie](compiler.md#cycle-de-vie-des-sorties-java) avant d'intervenir sur une génération interrompue. |
| `logs/` | Journaux locaux ignorés par `logs/.gitignore`, recréés par les runners. Les anciens journaux ont été archivés puis retirés lors du nettoyage M13. |
| Anciens `.purs.bak`, `output.bak/` | Retirés de l'arbre de travail après comparaison/restauration depuis Git ; références et restauration dans [l’historique](validation-history.md#sauvegardes-historiques). Le `.gitignore` du compilateur prévient leur réintroduction accidentelle. |

Le `.gitignore` du dossier parent `htdocs/javapurs` n'établit pas la politique du
dépôt Git imbriqué. Les règles de ce dépôt sont locales ; ignorer un chemin ne
retire pas les artefacts qui sont déjà suivis.

### Sauvegardes historiques

Les anciens `.purs.bak` et `output.bak/` sont conservés dans Git. Les références,
empreintes et la commande de restauration dans un dossier séparé sont dans
[l’archive des sauvegardes](validation-history.md#sauvegardes-historiques).

### Journaux et preuves

| Emplacement | Conservation |
| --- | --- |
| `logs/tests/NOM/` | Un log par phase ; remplacé au prochain run de cette fixture. |
| `logs/check-all/` | Un log par phase du contrôle agrégé ; remplacé au prochain contrôle. |
| `logs/modtest/PORT.log` | Remplacé au prochain run agrégé de ce port. |
| Workspaces temporaires des suites | Supprimés au succès, conservés à l’échec ; le runner affiche le chemin. |
| [Historique des validations](validation-history.md) | Références, résultats et limites versionnés des campagnes terminées. |

Avant de relancer un échec à conserver, copier ses logs et entrées utiles.
Pour transmettre un incident, joindre les sources ou empreintes, la configuration,
les outils sélectionnés, la commande et le résultat. Les anciens chemins sous
`/private/var/folders/…` désignent des preuves locales ; leur présence dépend de
la conservation du disque temporaire. Un ancien log ne valide pas le checkout
courant.

### Nettoyage demandé pendant M13

L’[inventaire du 3 octobre 2026](validation-history.md#nettoyage-demandé-pendant-m13)
conserve les tailles, chemins d’archives et vérifications avant retrait.

### Nettoyage demandé après M18

L’[inventaire du 5 octobre 2026](validation-history.md#archive-du-nettoyage-après-m18)
conserve les règles Git, empreintes et la restauration de l’archive locale.

## Points ouverts après le plan

Les clôtures des plans de maintenance décrivent leurs livrables ; les limites
suivantes restent des sujets indépendants :

| Sujet | État et point d’entrée |
| --- | --- |
| Couverture des ports | 48 suites standards et 7 auxiliaires ; les API et limites restent propres à chaque port. Consulter la [matrice FFI](port-ffi.md) avant de sélectionner une dépendance. |
| Aff et promesses | Threads daemon, annulation coopérative et réactions Promise eager ; [contrats runtime](ffi-runtime.md). |
| Compatibilité et distribution | Installation source et JAR livrables ; les résultats JDK 17/26 restent des [campagnes datées](validation-history.md#validation-m16). Les autres plateformes et API demandent leur propre validation. |
| Schéma TAST et preuves de type | Les tableaux enrichis sont exigés à l’entrée ; versionnement du schéma et complétude des preuves restent distincts. Voir les [barrières de preuve](representations.md#ce-qui-constitue-une-preuve). |
| Limites de génération | Budgets heuristiques du [chunker](chunking.md) et des [workers ownership](specialized-passes.md). |
| Licence | Le README déclare MIT ; aucun fichier de licence autonome n’est présent. |

Les étapes et mesures antérieures restent accessibles dans
[l’historique des validations](validation-history.md) et les plans
[v2](plan-v2.md), [v3](plan-v3.md), [v4](plan-v4.md), [v5](plan-v5.md),
[v6](plan-v6.md) et [v7](../todo.md).
