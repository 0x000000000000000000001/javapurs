# Reprise et entretien du dépôt

État documenté au **5 octobre 2026**, complété jusqu'au lot supplémentaire M19.
Cette page donne le parcours de reprise, le statut des artefacts et les points
encore ouverts. Les [preuves par lot](testing.md#consigner-une-validation)
conservent leurs dates, versions et périmètres d'origine.

## Parcours de reprise

1. Lire le [guide du compilateur](compiler.md#suivre-une-compilation) pour suivre
   `Main` → `Config` → `Driver` → `Input`/PBO → `Pipeline` → `Emit` → `Output`.
2. Choisir le contrat correspondant à la modification :

   | Sujet | Référence canonique |
   | --- | --- |
   | Nœuds, noms, captures, Java brut | [AST et portées](ast.md) |
   | Extraction et budget des helpers | [Chunking](chunking.md) |
   | Traduction et ordre d'évaluation | [Expressions](expressions.md) |
    | Types, stockage, ABI | [Représentations](representations.md) |
    | Entrée TAST, erreurs de lecture et graphe des imports | [Chargement strict](compiler.md#2-chargement-tast-et-optimisation-pbo) |
    | Appel de `main`, valeurs non exécutables et erreurs JVM | [Contrat du launcher](compiler.md#6-compilation-et-exécution-java) et [suites classes/JAR](testing.md#entrée-jvm-et-jar) |
   | Admission/refus des optimisations | [Passes spécialisées](specialized-passes.md) |
   | Corps Java et frontières Supplier | [Rendu](printing.md) |
    | Exceptions, callbacks, fibres, références, promesses | [FFI et runtimes](ffi-runtime.md), dont le [contrat Throwable](ffi-runtime.md#exceptions) |
   | FFI choisie, bindings et couverture | [Relevé de génération](ffi-runtime.md#relevé-de-la-génération) |
    | CLI, inventaire Java et récupération | [Pilote et sorties](compiler.md#cycle-de-vie-des-sorties-java) |
    | Références source, prérequis et JAR autonome | [Installation](installation.md) |
    | JDK de build, cible et JVM distincts | [Configuration et matrice Java](testing.md#build-jdk-cible-et-jvm) |

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
TODO et des cinq README de ports couverts en M10/M19, la syntaxe des exemples shell, les suites
de la matrice, les options de `Config`, le score du plan actif et les preuves de
ses lots cochés, y compris les lots complémentaires hors score. Le nombre de lots
pondérés est lu dans le TODO. Il ne lance pas les
exemples et n'a pas besoin du backend construit ni d'un JDK.

## Interfaces et replis relus

Les **48 modules** de `src/` exposent des listes explicites. Les façades ci-dessous
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
| `tools/source-lock.json`, `tools/install-source.mjs`, `examples/` | Références Git compatibles, export/reconstruction source isolée et exemples Hello/Refs. `installation.json`, logs, builds et JAR sont créés dans le workspace explicitement choisi. |
| `test/`, `tests/ffi-ports/`, `tests/port-suites/`, `tests/ffi/`, `tests/passing/` | Sources des régressions et surcharges. Les fixtures FFI/ports restent hors de `test/**/*.purs`, glob du build du backend. |
| `tests/runner/spago.yaml`, `spago.lock` | Configuration persistante du runner ; le YAML sert aussi aux workspaces isolés. |
| `output/` du compilateur | Modules JavaScript, FFI, source maps et `package.json` **suivis dans Git** ; `bin/javapurs.js` charge `output/Main/index.js`. Les métadonnées `corefn.json`, `docs.json`, `externs.cbor` et `cache-db.json` sont régénérables, retirées du checkout et ignorées. `./bin/build` reconstruit le tout après changement des sources. |
| `.spago/` | Dépendances et état Spago régénérables, désormais ignorés. Les copies locales, y compris les anciennes copies suivies du compilateur, ont été retirées lors du nettoyage après M18. |
| `.purs-repl` | Configuration persistante du REPL (`import Prelude`). |
| `.psci_modules/` | Ancien build REPL retiré lors du nettoyage demandé pendant M13 ; régénérable par le REPL et désormais ignoré. Le launcher du compilateur charge `output/`. |
| `.DS_Store`, `*.class`, `*.java.bak` | Métadonnées Finder, classes compilées isolées et sauvegardes Java ignorées dans les 55 dossiers. Les exemplaires identifiés ont été archivés puis retirés après M18. |
| `tests/runner/src`, `output`, `java_output`, `classes`, `.purmeta` | État remplaçable d'une fixture, ignoré par le `.gitignore` du runner. Son `spago.yaml` et ses sources d'origine restent persistants. |
| `output`/`java_output`, `.purmeta` dans un port | Entrées TAST, Java/classes et caches d'optimisation régénérables. Les copies présentes dans les ports ont été archivées puis retirées après M18, avec leurs anciennes entrées suivies ; les règles Git couvrent leur régénération. |
| `.javapurs-manifest.json`, `.javapurs-work/` dans une sortie Java | Propriété/SHA-256 des sources et relevé de sélection `ffi` de la même génération ; staging, verrou PID et journal de récupération. Voir le [cycle de vie](compiler.md#cycle-de-vie-des-sorties-java) avant d'intervenir sur une génération interrompue. |
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
   captures avant/après et dossiers `javapurs-m01` à `javapurs-m19` cités dans le
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

### Nettoyage demandé après M18

Le **5 octobre 2026**, revue de **55 dossiers** : le compilateur, 49 ports avec
leur dépôt Git et cinq packages locaux sans dépôt propre. Les 50 dépôts étaient
propres au départ ; leurs révisions sont conservées dans `inventory.json`.

Retrait de **177 301 fichiers / 2 963 812 640 octets**, dont **13 738 fichiers
suivis**, répartis ainsi :

| Artefacts retirés | Fichiers | Octets |
| --- | ---: | ---: |
| `output/` des ports | 62 084 | 1 808 608 169 |
| `java_output/` des ports, Java et classes | 87 689 | 323 992 116 |
| `.purmeta/` | 11 383 | 693 965 045 |
| `.spago/`, compilateur et runner inclus | 13 168 | 25 893 286 |
| `output.bak/` d'arrays, strings et strings-extra | 2 915 | 110 897 067 |
| Finder, `testRegex.class`, `Regex.java.bak` | 59 | 456 202 |
| `javapurs-node-fs/tmp/`, produit par ses tests | 3 | 755 |

Les sources maintenues, fragments FFI, configurations/lockfiles et le build
exécutable `javapurs/output/` ont leurs empreintes de conservation. Les règles
`.gitignore` couvrent les artefacts retirés, les classes et les métadonnées
imbriquées ; les fichiers source `.purs`, `.java`, `.js` restent sélectionnables.
Le launcher a été exercé, puis l'intégration FFI a reconstruit ses dépendances
dans un workspace temporaire et réussi **17 assertions × 2 modes**. Voir le
[relevé ciblé](testing.md#nettoyage-demandé-après-m18).

Archive locale **`retired-artifacts.tar.gz`**, **330 039 644 octets**, vérifiée
entrée par entrée (inventaire, SHA-256, modes et cibles de symlinks) avant retrait :
`/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-cleanup-628j912y/`.
Elle est accompagnée de `manifest.json`, `summary.json`, des références Git,
empreintes conservées et journaux. SHA-256 de l'archive :
`73abbb32715c7570b1c605656fc6c4cc90d3fda8640540457a6ffc04e14554c2`.

Pour restaurer les anciens artefacts dans un dossier séparé :

```bash
ARCHIVE="/private/var/folders/w9/l8bnb22d6c75c401f71djbt00000gn/T/opencode/javapurs-cleanup-628j912y/retired-artifacts.tar.gz"
RESTORE="$(mktemp -d)"
tar -xzf "$ARCHIVE" -C "$RESTORE"
```

## Points ouverts après le plan

Les scores M01–M11 et M12–M16 mesurent les livrables des deux plans terminés.
Les sujets techniques suivants gardent leurs limites documentées et leurs points
d'entrée :

| Sujet | Point d'entrée pour une suite de travail |
| --- | --- |
| Couverture FFI des bibliothèques et JAR applicatifs | M19 couvre [Exceptions](ffi-runtime.md#exceptions) et l'intégration en classes/JAR sur JVM 17/26 ; poursuivre port par port selon les chemins réellement exécutés. [Contrat FFI](ffi-runtime.md#résolution-et-insertion). |
| Scheduler Aff et interopérabilité asynchrone | Threads daemon ordinaires, annulation coopérative ; [durées de vie](ffi-runtime.md#supervision-parallèle-et-processus). |
| Sémantique JS des promesses | Réactions eager sans microtasks, sans désabonnement Promise ; [contrat Promise](ffi-runtime.md#promesses). |
| Distribution et extension de la compatibilité | [Installation source](installation.md) et [matrice ciblée JDK 17/26](testing.md#validation-m16) livrées ; les autres plateformes, API de ports et modes de distribution restent à mesurer. Le versionnement actuel des caches/builds reste un choix à traiter séparément. |
| Schéma TAST/PBO et preuves de type manquantes | Le [chargement strict M17](compiler.md#2-chargement-tast-et-optimisation-pbo) exige les tableaux enrichis et les imports présents. Le versionnement du schéma et la complétude des preuves restent distincts ; [replis et barrières d'instantiation](representations.md#ce-qui-constitue-une-preuve). |
| Taille des méthodes / admission d'optimisations | Budgets heuristiques du chunker et des workers ownership ; [chunking](chunking.md) et [passes](specialized-passes.md). |
| Licence | La déclaration MIT du README est conservée ; le dépôt n'a pas encore de fichier de licence autonome. |

Le [plan v2 M12–M16](../../todo.md) est terminé à **100/100** : fiabilité des
runners asynchrones, CLI/sorties Java, diagnostic FFI, installation source et
compatibilité JDK mesurée. Les [preuves M16](testing.md#validation-m16) en
conservent la clôture et les limites ; les [preuves M11](testing.md#validation-m11)
restent la référence de clôture du plan v1.

Le complément **M17 est clôturé** : chargement TAST strict, refus avant préparation
des sorties et génération Java conservée sur les références figées. Ses
[preuves](testing.md#validation-m17) comprennent le backend reconstruit dans un
workspace neuf. Les deux scores précédents restent ceux de leurs plans respectifs.

Le complément **M18 est clôturé** : une valeur `main` non exécutable produit un
échec JVM explicite ; les deux ABI valides et les exceptions de l'action sont
vérifiées en classes et JAR sur JVM 26/17. Les [preuves](testing.md#validation-m18)
limitent les écarts Java des références figées à la branche de contrôle des launchers.

Le complément **M19 est clôturé** : noms/en-têtes/causes cohérents et identité
Throwable préservée, y compris via Aff/Promise. Les [preuves](testing.md#validation-m19)
incluent les JAR autonomes dans les deux modes records et les JVM 26/17 ; la
comparaison Java sur TAST figé isole le seul fragment Exceptions corrigé.
