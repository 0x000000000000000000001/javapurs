# Reprise et entretien du dépôt

État documenté au **3 octobre 2026**, complété pendant le plan v2 M12–M16.
Cette page donne le parcours de reprise, le statut des artefacts et les points
encore ouverts. Les [preuves par lot](testing.md#consigner-une-validation)
conservent leurs dates, versions et périmètres d'origine.

## Parcours de reprise

1. Lire le [guide du compilateur](compiler.md#suivre-une-compilation) pour suivre
   `Main` → `Config` → `Driver` → PBO → `Pipeline` → `Emit` → `Output`.
2. Choisir le contrat correspondant à la modification :

   | Sujet | Référence canonique |
   | --- | --- |
   | Nœuds, noms, captures, Java brut | [AST et portées](ast.md) |
   | Extraction et budget des helpers | [Chunking](chunking.md) |
   | Traduction et ordre d'évaluation | [Expressions](expressions.md) |
   | Types, stockage, ABI | [Représentations](representations.md) |
   | Admission/refus des optimisations | [Passes spécialisées](specialized-passes.md) |
   | Corps Java et frontières Supplier | [Rendu](printing.md) |
    | Callbacks, fibres, références, promesses | [FFI et runtimes](ffi-runtime.md) |
    | CLI, inventaire Java et récupération | [Pilote et sorties](compiler.md#cycle-de-vie-des-sorties-java) |

3. Sélectionner les lignes pertinentes de la [matrice](testing.md#matrice-des-tests).
   Reconstruire après modification des sources du backend/PBO. Pour une modification
   de génération, figer TAST/options/FFI et comparer inventaire et octets Java.
4. Mettre à jour le contrat et son entrée de validation, puis exécuter :

   ```bash
   node tools/check-docs.mjs
   git diff --check
   ```

Le vérificateur utilise Node et Bash. Il retrouve le dépôt depuis son propre
chemin ; les liens locaux supposent le layout des dépôts voisins décrit dans
`compiler.md`. Il contrôle les liens/ancres Markdown des guides, du README, du
TODO et des quatre README de ports M10, la syntaxe des exemples shell, les suites
de la matrice, les options de `Config`, le score du plan actif et les preuves de
ses lots cochés. Le nombre de lots est lu dans le TODO. Il ne lance pas les
exemples et n'a pas besoin du backend construit ni d'un JDK.

## Interfaces et replis relus

Les **47 modules** de `src/` exposent des listes explicites. Les façades ci-dessous
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
opaque et workers persistants sont des chemins d'exécution testés. Le `TODO`
dans le rendu `null /* TODO: PrimUndefined */` est un marqueur historique du
sentinel Undefined de PBO ; `Raw.isClosedValue` reconnaît cette forme fermée.
Il ne signale pas un dispatcher manquant à remplacer par une spécialisation.

## Statut des fichiers et des sorties

| Emplacement | Propriétaire et statut |
| --- | --- |
| `src/`, `tools/`, `bin/` | Sources maintenues. Les fichiers `.purs` courants sont la référence du backend. |
| `test/`, `tests/ffi-ports/`, `tests/port-suites/`, `tests/ffi/`, `tests/passing/` | Sources des régressions et surcharges. Les fixtures FFI/ports restent hors de `test/**/*.purs`, glob du build du backend. |
| `tests/runner/spago.yaml`, `spago.lock` | Configuration persistante du runner ; le YAML sert aussi aux workspaces isolés. |
| `output/` du compilateur | Build JavaScript/externs **suivi dans Git** ; `bin/javapurs.js` charge `output/Main/index.js`. Il est régénéré par `./bin/build` après changement des sources. |
| `.spago/` | Dépendances et état Spago, dont des fichiers sont déjà suivis. Spago les gère ; ils ne sont pas une deuxième implémentation du backend. |
| `.purs-repl` | Configuration persistante du REPL (`import Prelude`). |
| `.psci_modules/` | Ancien build REPL retiré lors du nettoyage demandé pendant M13 ; régénérable par le REPL et désormais ignoré. Le launcher du compilateur charge `output/`. |
| `.DS_Store` | Métadonnées Finder retirées et ignorées dans le dépôt du compilateur. |
| `tests/runner/src`, `output`, `java_output`, `classes`, `.purmeta` | État remplaçable d'une fixture, ignoré par le `.gitignore` du runner. Son `spago.yaml` et ses sources d'origine restent persistants. |
| `output`/`java_output` dans un port ou une application | Entrées TAST/sorties Java propres à ce projet. Certains ports versionnent leurs sorties ; examiner leur statut local avant nettoyage. |
| `.javapurs-manifest.json`, `.javapurs-work/` dans une sortie Java | Propriété et SHA-256 des sources générées ; staging, verrou PID et journal de récupération. Voir le [cycle de vie](compiler.md#cycle-de-vie-des-sorties-java) avant d'intervenir sur une génération interrompue. |
| `logs/` | Journaux locaux ignorés par `logs/.gitignore`, recréés par les runners. Les anciens journaux ont été archivés puis retirés lors du nettoyage M13. |
| Anciens `.purs.bak`, `output.bak/` | Retirés de l'arbre de travail après comparaison/restauration depuis Git ; références exactes ci-dessous. Le `.gitignore` du compilateur prévient leur réintroduction accidentelle. |

Le `.gitignore` du dossier parent `htdocs/javapurs` n'établit pas la politique du
dépôt Git imbriqué. Les règles de ce dépôt sont locales ; ignorer un chemin ne
retire pas les artefacts qui sont déjà suivis.

### Sauvegardes historiques

Les deux sources `.bak` étaient des versions monolithiques du **16 août 2026** :
anciens noms de modules, parcours et rendu antérieurs aux passes actuelles.
`output.bak` était un build du **25 août 2026**, identifié comme PureScript
**0.15.15**, avec 420 dossiers de modules et 2 152 fichiers JS/JSON/maps/externs.
Les quatre modules Main/CodeGen/Printer/Rename examinés portent l'ancien schéma
CoreFn. Aucun launcher, outil, test ou configuration du backend ne les consomme ;
les chemins de production sont `src/**/*.purs` et `output/`.

Archive de référence : commit **`eba169d42727ec1a9065235262c20b74c665f781`**.

| Ancien chemin | Taille | Objet Git dans cette référence |
| --- | ---: | --- |
| `src/Javapurs/CodeGen.purs.bak` | 20 861 octets | blob `8f251affaed02a6ceb989517748d5f42b1ab6656` |
| `src/Javapurs/Printer.purs.bak` | 8 396 octets | blob `85c688ea778296b6457cb9503e9d55fa3e0d3a92` |
| `output.bak/` | 57 620 099 octets | tree `9152fdc3579c1cf376ac06a262eb3e891647ac11` |

Avant retrait, les **2 154 fichiers** ont été comparés à cette référence, archivés
localement puis restaurés dans un dossier isolé : même inventaire, tailles et
SHA-256. La restauration reste possible depuis le dépôt, indépendamment de cette
copie locale. Exemple, depuis la racine du compilateur :

```bash
RESTORE="$(mktemp -d)"
git archive --format=tar \
  eba169d42727ec1a9065235262c20b74c665f781 \
  output.bak src/Javapurs/CodeGen.purs.bak src/Javapurs/Printer.purs.bak \
  > "$RESTORE/snapshots.tar"
tar -xf "$RESTORE/snapshots.tar" -C "$RESTORE"
```

Cela retire **57 649 356 octets de copies** de l'arbre courant ; les objets
historiques restent dans Git. L'ancien build restauré sert à examiner une étape
historique, avec ses propres dépendances et son format d'entrée.

### Journaux et preuves

- **`logs/*.log`** : campagnes historiques de tests/ports, avec succès et échecs,
  archivées hors du dépôt puis retirées lors du nettoyage M13. Par exemple,
  `test-regression.log` termine en échec sur `EmptyTypeClass`, tandis que
  `test-final4.log` annonce 361 succès. Ces fichiers ne sont pas un verdict sur
  le checkout actuel et ne portent pas tous les versions/empreintes nécessaires
  à une reproduction. Les limites des anciens runners Aff sont précisées en M10.
- **`logs/tests/NOM/`** : producteur `passing-runner`/`fixture-runner`, une phase
  par fichier ; remplacé au prochain run du même nom. Copier les entrées et logs
  utiles d'un échec avant ce remplacement.
- **`logs/modtest/PORT.log`** : sortie du runner historique des ports, écrasée au
  prochain run de ce port. Les campagnes agrégées restent hors du protocole du plan.
- **Temporaires des suites** : supprimés au succès et conservés à l'échec. Les
   captures avant/après et dossiers `javapurs-m01` à `javapurs-m13` cités dans le
  registre sont des preuves **locales**, pas des artefacts distribués avec le dépôt.
  Leur durée de conservation dépend du disque temporaire ; pour transmettre un
  incident, joindre sources/empreintes, configuration, commande et logs utiles.
- **`docs/testing.md`** : synthèse versionnée des références, périmètres, résultats
  et limites. Les références b8x/BigFunction historiques restent datées ; chaque
  nouvelle validation choisit les seuls contrôles concernés par le changement.

Le relevé M11 conserve l'inventaire et les empreintes des **118 journaux** alors
présents.

### Nettoyage demandé pendant M13

Le **3 octobre 2026**, retrait de **3 641 fichiers / 80 859 191 octets** : ancien
build REPL (903 fichiers), 118 journaux sous `logs/`, cinq anciens logs du runner,
métadonnées Finder et état généré de `tests/runner` (`src`, `output`, `java_output`,
`classes`, `.purmeta`). Le `src/Main.purs` du runner était identique à la fixture
`purescript/tests/purs/passing/DerivingTraversable.purs` ; ses configurations
persistantes permettent de recréer cet état avec une sélection nommée.

Les fichiers ont été inventoriés, archivés et relus dans l'archive avec
vérification des tailles/SHA-256 avant suppression. Archive et manifeste locaux :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-m13/cleanup/`,
fichiers `retired-artifacts.tar.gz`, `manifest.json` et `summary.json`. Les règles
Git du compilateur couvrent désormais `.psci_modules/` et `.DS_Store`.

## Points ouverts après le plan

Le score M01–M11 mesure les livrables de maintenabilité du plan v1. Les sujets
techniques suivants gardent leurs limites documentées et leurs points d'entrée :

| Sujet | Point d'entrée pour une suite de travail |
| --- | --- |
| Couverture FFI des bibliothèques et JAR applicatifs | Vérifier les chemins réellement exécutés par port ; [contrat FFI](ffi-runtime.md#résolution-et-insertion). |
| Scheduler Aff et interopérabilité asynchrone | Threads daemon ordinaires, annulation coopérative ; [durées de vie](ffi-runtime.md#supervision-parallèle-et-processus). |
| Sémantique JS des promesses | Réactions eager sans microtasks, sans désabonnement Promise ; [contrat Promise](ffi-runtime.md#promesses). |
| Installation, distribution et matrice JDK | Build source et classpaths explicites ; [prérequis](../README.md#prerequisites). Le versionnement actuel des caches/builds reste un choix à traiter séparément. |
| Schéma TAST/PBO et preuves de type manquantes | Replis génériques et barrières d'instantiation ; [preuves de type](representations.md#ce-qui-constitue-une-preuve). |
| Taille des méthodes / admission d'optimisations | Budgets heuristiques du chunker et des workers ownership ; [chunking](chunking.md) et [passes](specialized-passes.md). |
| Licence | La déclaration MIT du README est conservée ; le dépôt n'a pas encore de fichier de licence autonome. |

Le [plan v2 M12–M16](../../todo.md) précise les prochains objectifs : fiabilité
des runners asynchrones historiques, CLI/sorties Java, diagnostic FFI,
installation source et compatibilité JDK. Chaque lot possède son périmètre et
ses contrôles ciblés ; son avancement est indépendant du score du plan v1.
Les [preuves M11](testing.md#validation-m11) conservent la clôture de ce dernier.
