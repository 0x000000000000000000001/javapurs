# Guide du compilateur Javapurs

État documenté au **3 octobre 2026**. Ce guide décrit le chemin de production
actuel. Les références des sources et des outils figurent dans le
[registre de validation](testing.md#validation-m13). Le
[guide de reprise et d'entretien](maintenance.md) complète cette carte par les
interfaces de compatibilité, le statut des artefacts et les points ouverts.

## Se repérer dans le workspace

```text
htdocs/
├── purescript/                             fork du frontend et du TAST
├── purescript-backend-optimizer-javapurs/   dépendance locale PBO
├── javapurs/
│   ├── todo.md                            plan de travail actif du workspace
│   ├── javapurs/                          dépôt de ce guide
│   │   ├── bin/                           lancement, build et runners
│   │   ├── src/Main.purs                   entrée du processus Node
│   │   ├── src/Javapurs/                   pilote, traduction, analyses et rendu
│   │   ├── test/                          régressions directes Node/Java
│   │   ├── tests/runner/                   workspace des fixtures PureScript
│   │   └── tools/                         sélection, workspaces et processus de test
│   └── javapurs-*/                        bibliothèques et FFI Java
└── b8x/                                   application d'intégration
```

Les liens vers les dépôts voisins suivent ce layout local. Le
[spago.yaml du compilateur](../spago.yaml) référence PBO et
`javapurs-foreign-object` par chemin ; les ports applicatifs sont sélectionnés
dans la configuration Spago de chaque application. Le
[workspace des fixtures](../tests/runner/spago.yaml) en donne un exemple.

### Deux compilations et leurs fichiers

| Emplacement | Producteur et rôle |
| --- | --- |
| Compilateur : `output/Main/index.js` et `output/Javapurs.*/` | `./bin/build` exécute `spago build` ; ces modules JavaScript font fonctionner l'outil sous Node. |
| Application : `output/<Module>/corefn.json` | Le fork PureScript produit l'entrée enrichie lue par PBO. |
| Application : `.purmeta/<Module>.purmeta` | PBO conserve des implémentations optimisées pour les dépendances ; certaines suites peuvent examiner ces caches. |
| Application : `java_output/` (ou `--java-output`) | Javapurs publie les classes de modules, helpers, FFI insérée, launcher et manifeste de propriété. |
| Répertoire passé à `javac -d` | `javac` produit les `.class` exécutés par la JVM ; le backend ne choisit pas cette destination. |

Le nom `output/` désigne donc le build de l'outil quand on travaille dans son
dépôt, et l'entrée TAST quand on lance cet outil depuis une application.
Reconstruire l'outil après modification de ses sources ou de PBO :
[bin/javapurs.js](../bin/javapurs.js) importe directement le `Main` déjà construit.

Le [statut des fichiers](maintenance.md#statut-des-fichiers-et-des-sorties)
précise les sorties actuellement suivies dans Git, les workspaces temporaires
et les sauvegardes historiques retirées avec leur procédure de restauration.

## Suivre une compilation

### 1. Entrée et configuration

[bin/javapurs](../bin/javapurs) démarre Node avec `--expose-gc`, une pile de
65 536 Kio et un heap maximal de `JAVAPURS_HEAP` Mio, 16 384 par défaut.
Le shell se remplace par Node via `exec`. `bin/javapurs.js` appelle ensuite
[Main.main](../src/Main.purs).

`Main` lit `Node.Process.argv`, retire les deux arguments Node/script, appelle
[Config.parseArgs](../src/Javapurs/Config.purs) et traite son résultat
`Either String Command` : diagnostic/code 2, aide/code 0, ou compilation.
Il lance [Driver.compile](../src/Javapurs/Driver.purs) sous la mesure `backend total`
et convertit les erreurs de compilation/I/O en code 1.
La configuration nomme les chemins, le module principal, la limite PBO et les
options du pipeline. `CodegenOptions` est aussi le type de l'entrée complète de
`CodeGen` ; `PipelineOptions` lui ajoute le choix du chunking.

La [table des options](../README.md#compiler-options) correspond à `Config`.
Les arguments inconnus, valeurs manquantes/vides, répétitions et conflits échouent
avant compilation. Les options à valeur acceptent `--nom valeur` et `--nom=valeur`.
`--main` vaut `Main` par défaut ; `--no-main` sélectionne explicitement une
bibliothèque. Les deux options sont exclusives.

`--input` configure l'entrée TAST (`output` par défaut) et `--java-output` la
destination (`java_output` par défaut), relativement au dossier appelant. Le
backend crée la destination et ses parents. `--output` est un **alias d'entrée** :
Spago 1.0.3 passe les `backend.args`, puis ajoute `--output` et le chemin TAST
absolu lorsque son option de sortie est renseignée. Aucun argument positionnel
`build` n'est transmis. La paire d'alias `--input`/`--output` compte comme une seule
option ; le parseur générique et les options FFI de PBO ne sont pas utilisés ici.

Les chemins TAST/Java doivent être disjoints : même chemin ou inclusion dans
l'autre rejetés, y compris à travers les ancêtres symlinks. Après chargement,
`Driver.validateMain` exige un module présent, avec un `main` exporté défini
localement (binding PureScript ou foreign). Un simple réexport est refusé. Ces
contrôles précèdent la création du dossier de sortie ; l'ABI de `main` reste
celle du runtime décrit ci-dessous.

### 2. Chargement TAST et optimisation PBO

`App.coreFnModulesFromOutput` lit les `corefn.json` puis trie les modules par
dépendances. Le vocabulaire TAST/`tcorefn` désigne le format enrichi du fork ; le
chemin consommé ici reste `output/<Module>/corefn.json`.

Dans le fork Haskell, [Make](../../../purescript/src/Language/PureScript/Make.hs)
enchaîne typage, conversion CoreFn, optimisation et renommage.
[CoreFn.Desugar.moduleToCoreFn](../../../purescript/src/Language/PureScript/CoreFn/Desugar.hs)
réalise la conversion ; [CoreFn.ToJSON.moduleToJSON](../../../purescript/src/Language/PureScript/CoreFn/ToJSON.hs)
sérialise notamment `dataDecls`, `classDecls` et `typeTable`.
[Make.Actions](../../../purescript/src/Language/PureScript/Make/Actions.hs) écrit
le JSON pour la cible CoreFn. Côté PBO,
[CoreFn.Json.Text](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/CoreFn/Json/Text.purs)
est le point d'entrée du décodage appelé par `App`.

Les types d'expression, `dataDecls`, `classDecls` et la table de types appartiennent
à cette frontière. Après décodage et optimisation, le backend travaille sur les
types PBO et leurs nœuds `Typed`/`TypeApp`, pas sur le JSON brut. Un argument de
`TypeApp` n'est pas à lui seul le type du résultat : le guide
[Types, représentations et conventions d'appel](representations.md) relie les
producteurs de preuves, leur propagation et les types Java effectivement émis.

`Driver.compile` rend visibles le chargement/tri, la préparation des directives
et helpers communs, puis l'optimisation/émission vers le staging. `Output` ajoute
la phase finale de publication. Le pilote appelle le
builder séquentiel `buildModules`, avec les sémantiques étrangères communes et
la limite de réécriture configurée, 10 000 par défaut. Il fournit les hooks de
préparation, cache et émission.
Le hook `onSkipModule` renvoie actuellement `Nothing` : la présence de `.purmeta`
ne constitue pas un cache des fichiers Java émis par Javapurs.

Points d'entrée PBO : [App](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/App.purs),
[Builder](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/Builder.purs),
[CoreFn](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/CoreFn.purs).

### 3. Traduction d'un module

Le hook `onCodegenModule` appelle `Driver.compileModule`. Celui-ci lit le fragment
Java par [Ffi.loadForeign](../src/Javapurs/Ffi.purs), puis abaisse le module via
[Pipeline.lowerModule](../src/Javapurs/Pipeline.purs). Ce pipeline pur transforme
un `BackendModule` en `JavaFile` : traduction, renommage, puis chunking optionnel.
Sa première étape, `CodeGen.translateWithIntFunctions`, coordonne dans l'ordre :

1. `Ownership.prepare`, si activé : sélection des fonctions consommatrices,
   réécriture du module, déclarations de workers et classes rendues mutables.
2. Analyse TCO des bindings, puis `RecordTypes.annotateRecordTypes`.
3. `FunctionTypes.annotateFunctionTypes`, si les fonctions Int sont activées.
4. Traduction des expressions, fonctions, bindings récursifs et branches dans
   `CodeGen.Expr`. `translateLoop` prépare les invariants et les paramètres Int lorsque les
   conditions de contrôle le permettent.
5. Déclarations des classes d'ADT depuis `dataDecls`, collecte des formes de
   records et assemblage d'un `JavaFile`.
6. `DirectCalls.directCalls`, si activé, puis `Reuse.reuseConstructors`.

Le résultat contient `decls` et `recordShapes`. Les entrées simplifiées comme
`translate` ou `translateWithRecords` donnent des valeurs par défaut aux
options supplémentaires. Elles ne réalisent pas les étapes suivantes de `Pipeline`.

[Traduction des expressions](expressions.md) détaille le dispatcher, les contextes
de position/effet, les captures des closures, les priorités des appels et le
contrat `Translation` : statements ordonnés puis résultat dans leur portée.

Le guide des [passes spécialisées](specialized-passes.md) expose sélection,
admission, transformation et repli pour appels directs, boucles, invariants,
réutilisation et ownership. Il relie chaque preuve aux contre-exemples testés.

### 4. Noms lexicaux puis découpage

`Pipeline.lowerModule` applique `Rename.renameExpr` aux déclarations, puis `Chunk.chunkFile`,
sauf avec `--no-chunk`. **Cet ordre est un contrat de la passe.**

- `Rename` distingue les bindings homonymes par des suffixes `$rN` et restaure
  les environnements à la sortie des blocs, lambdas et branches. Les valeurs
  et les cibles de boucle ont des environnements distincts.
- `Chunk` décide quelles valeurs peuvent devenir des méthodes `__chunk$N`.
  `Chunk.Captures` décrit dépendances et barrières ; `Chunk.Extraction` décide
  de l'admission. Les variables libres deviennent des paramètres avec leur type
  Java effectif.
- L'appel produit conserve les dépendances de ses arguments : une extraction
  englobante doit encore transporter ces captures.
- Les mutations de locaux extérieurs, sauts de boucle et fragments Java opaques
  imposent des restrictions d'extraction. Les initialiseurs récursifs gardent
  leurs accès aux cellules du scope récursif.

Le budget courant est 256 unités ; les scopes de blocs/lets sont pondérés par
`4 * min (257, coût)`, et les helpers sont limités à 64 paramètres. Ce coût guide
le découpage du travail de `javac` et de la taille des méthodes ; il ne mesure
pas exactement les octets de bytecode. `BigFunction` a montré qu'un budget
additif seul laissait des `Supplier` profondément imbriqués très coûteux à
attribuer. Voir le [guide du chunker](chunking.md) et ses
[régressions ciblées](testing.md#chunker-et-bigfunction).

Les contrats de chaque famille de nœuds, les binders et les parcours communs
sont détaillés dans [AST Java, parcours et portées](ast.md).

### 5. Rendu, FFI et écritures

[Emit.emitModule](../src/Javapurs/Emit.purs) appelle `Printer.printExpr` pour les
déclarations du fichier découpé et `RecordPrinter` pour les classes de records.
Il assemble la classe avec les membres étrangers produits par `Ffi.renderForeign`.
Son helper `writeJava` annote les erreurs avec le nom Java, puis délègue à
[Output](../src/Javapurs/Output.purs), propriétaire du staging et de la publication.

Le [guide du rendu Java](printing.md) détaille le dispatcher, le plan des corps
dans `Printer.Body`, les déclarations, les frontières `Supplier` et l'échappement
commun de `Printer.Syntax`. Les renderers de records utilisent les mêmes
constructions de chaînes et d'enveloppes.

| Fichier généré | Responsabilité actuelle |
| --- | --- |
| `__M$App_Main.java` pour `App.Main` | Nom dans `Naming.modulePrefix`, membres étrangers dans `Ffi`, assemblage et staging dans `Emit.emitModule`. |
| `__Record$….java` | Nom structurel dans `RecordShapes`, corps dans `RecordPrinter`, staging dans `Emit.emitModule`. |
| `__IntFn.java` | `Runtime.intFunctionSource`, préparé une fois par `Emit.emitRuntime`. |
| `TcoLoop.java` | `Runtime.tcoLoopSource`, préparé une fois par `Emit.emitRuntime` si au moins un module est chargé. |
| `MainRun.java` | `Runtime.mainRunSource`, préparé par `Emit.emitModule` pour le module sélectionné par `--main`. |
| `.javapurs-manifest.json` | Inventaire version 1 et SHA-256 des fichiers Java, publié par `Output` après les sources. |

[Runtime](../src/Javapurs/Runtime.purs) possède les trois templates communs et les
cinq implémentations globales intégrées de `builtinGlobalSource`, sans I/O.
`IntFunctions.runtimeSource` reste un alias vers le
template `__IntFn`, utilisé par les fixtures et benchmarks existants. Une entrée
vide est admise avec `--no-main` et produit seulement `__IntFn.java` et le manifeste.

Les classes utilisent le package Java par défaut. `__M$Main` représente le module
PureScript `Main` ; `MainRun` est l'entrée JVM. Les constructeurs sont des classes
imbriquées, par exemple `__M$Data_Maybe.Just`. Les noms de fichiers contenant `$`
doivent être entourés de quotes simples lorsqu'ils apparaissent littéralement
dans une commande shell, par exemple `'__M$Main.java'`.

`--main` sélectionne le launcher parmi les modules chargés. Le pilote ne filtre
pas les modules chargés par atteignabilité depuis ce point d'entrée. Les sorties
inventoriées de modules supprimés/renommés sont retirées lors de la publication.
Une sélection invalide échoue en conservant la génération précédente ; un succès
`--no-main` retire son ancien launcher inventorié.

### Cycle de vie des sorties Java

[Output.purs](../src/Javapurs/Output.purs) encadre l'action du pilote avec `bracket` :
acquisition, émission, publication mesurée, libération. Son
[FFI Node](../src/Javapurs/Output.js) possède les opérations filesystem :

1. Création de la destination et acquisition exclusive de `.javapurs-work/` par
   `mkdir`. `owner.json` enregistre le PID ; un propriétaire vivant produit
   `Java output is busy`. Lecture du manifeste de la génération précédente.
2. Émission sous `stage/`. L'inventaire accepte les noms Java simples ; deux
   productions de même nom sont permises seulement si leurs octets coïncident.
   Un échec à cette étape conserve les sources publiées.
3. Avant publication, contrôle de tous les fichiers concernés et du manifeste.
   Chaque fichier géré doit encore correspondre à son SHA-256 enregistré. Un
   fichier étranger portant un nom émis est adopté seulement s'il est identique.
   Répertoires, symlinks, fichiers modifiés et collisions sont préservés avec
   diagnostic. Les fichiers gérés devenus inutiles sont inclus dans les retraits.
4. Sauvegarde des fichiers remplacés/retirés sous `backup/`, puis écriture atomique
   du journal `publishing`. Retrait de l'ancien `MainRun.java`, publication des
   modules/helpers, puis du nouveau launcher, même si celui-ci est identique.
   Le manifeste `{ "version": 1, "files": { "Nom.java": "sha256" } }` est écrit
   ensuite, puis le journal passe à `committed` et le dossier de travail est retiré.
5. Sur erreur de publication, restauration de la génération et du manifeste
   précédents. La restauration valide d'abord toutes les empreintes et sauvegardes,
   puis restaure le launcher après ses modules. Un conflit externe ou une erreur
   de restauration conserve le journal pour une reprise explicite.

À la prochaine acquisition, si le PID précédent est mort, un journal `publishing`
entraîne cette restauration ; `committed` conserve les nouveaux fichiers ; sans
journal, seul le staging est abandonné. Un message signale la récupération. Des
métadonnées de reprise incomplètes/invalides arrêtent l'opération sans supprimer
ce dossier. Pour diagnostiquer une reprise refusée, conserver `.javapurs-work`,
examiner le chemin signalé, son entrée dans `journal.json` et sa sauvegarde avant
de rétablir les octets attendus ou de choisir une destination neuve.

La publication est journalisée **fichier par fichier**. Le succès du processus
signale la fin de la génération ; `.javapurs-work` indique une opération active
ou une récupération à terminer. Les tests couvrent erreurs filesystem et mort
du processus ; il n'y a pas de protocole `fsync` garantissant la durabilité après
une coupure machine.
L'inventaire concerne les sources Java, tandis que les caches PBO `.purmeta` et
les classes produites par `javac` ont leur propre cycle de vie.

**Migration des sorties anciennes :** sans manifeste, seuls les fichiers
identiques à la génération courante sont adoptés. Les autres fichiers étrangers
restent en place ; un ancien launcher non inventorié fait échouer `--no-main`
pour rendre explicite le conflit. Utiliser une destination neuve via
`--java-output`, ou archiver les anciennes sources générées identifiées avant
de les régénérer, permet d'établir le premier inventaire.

### 6. Compilation et exécution Java

L'appelant lance `javac`, fournit les JAR éventuels et choisit la cible de
bytecode. `MainRun` lit le champ `main` du module et exécute un `Supplier` par
`get()` ou une `Function` par `apply(null)`.

Les commandes minimales et le classpath sont dans le
[README](../README.md#compile-and-run-an-application). Pour b8x, les scripts
[build](../../../b8x/bin/build) et [_javapurs](../../../b8x/bin/_javapurs)
emploient les records Maps, `javac --release 17` et les JAR de
`run/bak/java/lib/`. Ce sont des choix d'intégration applicative.

### Diagnostics et durées

[Metrics.measure](../src/Javapurs/Metrics.purs) conserve les libellés `load TAST + sort`,
`prepare`, `optimize + emit`, `publish Java` et `backend total`. Les phases sont incluses dans
le total, et un échec est marqué `(failed)` avant propagation.
Depuis M03, l'écriture unique de `TcoLoop` appartient à `prepare`.

[Diagnostics.withContext](../src/Javapurs/Diagnostics.purs) ajoute le contexte aux
erreurs remontées par le chargement, la lecture FFI et les écritures. Exemples :
`load TAST from output: ENOENT…`,
`compile module Missing: read Java FFI src/Missing.java: EISDIR…` ou
`publish Java to java_output: Java output conflict; preserving …`.
La frontière `Main` produit un code de sortie 1 pour ces erreurs.
Le chargement reste celui de PBO : un fichier CoreFn absent peut être ignoré,
et une erreur de décodage est journalisée avant d'écarter le module concerné.

## Où se trouve une responsabilité ?

| Question | Sources à lire |
| --- | --- |
| Où sont définies les options et les valeurs par défaut ? | [Main](../src/Main.purs), [Config](../src/Javapurs/Config.purs). |
| Comment sont pilotées les phases et les durées ? | [Driver](../src/Javapurs/Driver.purs), [Metrics](../src/Javapurs/Metrics.purs), [Diagnostics](../src/Javapurs/Diagnostics.purs). |
| Quel est l'ordre des passes Java après PBO ? | [Pipeline](../src/Javapurs/Pipeline.purs). |
| Qui lit les fragments FFI et assemble les fichiers Java ? | [Ffi](../src/Javapurs/Ffi.purs), [Emit](../src/Javapurs/Emit.purs). |
| Qui possède inventaire, publication et récupération ? | [Output](../src/Javapurs/Output.purs), [FFI filesystem](../src/Javapurs/Output.js). |
| Où sont les templates communs et le launcher JVM ? | [Runtime](../src/Javapurs/Runtime.purs). |
| Comment sont nommés modules, constructeurs et locaux ? | [Naming](../src/Javapurs/Naming.purs), [Rename](../src/Javapurs/Rename.purs). |
| Quels nœuds Java existent et quels sont leurs enfants/portées ? | [JavaAst](../src/Javapurs/JavaAst.purs), [contrats de l'IR](ast.md). |
| Où sont analysés les sauts et leurs frontières ? | [ControlFlow](../src/Javapurs/ControlFlow.purs). |
| Quel texte brut peut être renommé ou considéré sans captures ? | [Raw](../src/Javapurs/Raw.purs). |
| Comment sont traduits applications, effets, bindings et branches ? | [CodeGen](../src/Javapurs/CodeGen.purs), [Expr](../src/Javapurs/CodeGen/Expr.purs), [Context](../src/Javapurs/CodeGen/Context.purs), [Syntax](../src/Javapurs/CodeGen/Syntax.purs), [guide des expressions](expressions.md). |
| Quelle preuve de type peut être projetée ou propagée ? | [TypeEvidence](../src/Javapurs/TypeEvidence.purs), [FunctionTypes](../src/Javapurs/FunctionTypes.purs), [RecordTypes](../src/Javapurs/RecordTypes.purs). |
| Quand un paramètre ou une fonction devient-il primitif ? | [Representation](../src/Javapurs/Representation.purs), [IntLoops](../src/Javapurs/IntLoops.purs), [IntFunctions](../src/Javapurs/IntFunctions.purs), [guide des représentations](representations.md). |
| Quels calculs peuvent être mis en cache dans une boucle ? | [PureInvariants](../src/Javapurs/PureInvariants.purs), [LoopInvariants](../src/Javapurs/LoopInvariants.purs). |
| Quand utilise-t-on un worker statique ou un constructeur existant ? | [DirectCalls](../src/Javapurs/DirectCalls.purs), [Reuse](../src/Javapurs/Reuse.purs). |
| Quelle preuve autorise la consommation d'un arbre ? | [Ownership](../src/Javapurs/Ownership.purs), [Candidates](../src/Javapurs/Ownership/Candidates.purs), [Analysis](../src/Javapurs/Ownership/Analysis.purs), [guide des passes](specialized-passes.md). |
| Qui gère snapshots, cellules et émission des workers consommateurs ? | [Model](../src/Javapurs/Ownership/Model.purs), [Cells](../src/Javapurs/Ownership/Cells.purs), [Workers](../src/Javapurs/Ownership/Workers.purs). |
| Quels records peuvent avoir une classe spécialisée ? | [RecordTypes](../src/Javapurs/RecordTypes.purs), [RecordShapes](../src/Javapurs/RecordShapes.purs). |
| Pourquoi une expression est-elle extraite dans un helper ? | [Chunk](../src/Javapurs/Chunk.purs), [Captures](../src/Javapurs/Chunk/Captures.purs), [Extraction](../src/Javapurs/Chunk/Extraction.purs), [guide du chunker](chunking.md). |
| Comment sont rendus blocs, boucles, classes et records ? | [Printer](../src/Javapurs/Printer.purs), [Body](../src/Javapurs/Printer/Body.purs), [Declarations](../src/Javapurs/Printer/Declarations.purs), [RecordPrinter](../src/Javapurs/RecordPrinter.purs), [guide du rendu](printing.md). |
| Où sont les chaînes Java et les enveloppes Supplier communes ? | [Printer.Syntax](../src/Javapurs/Printer/Syntax.purs). |
| Où sont fixées les représentations des littéraux Char/Number ? | [Literals](../src/Javapurs/Literals.purs), partagé par la traduction ordinaire et ownership. |
| Qui possède annulation, callbacks, références et promesses ? | [Contrats FFI et runtimes](ffi-runtime.md), fragments Java des ports et pont PureScript Promise/Aff. |

`JavaExpr` représente valeurs, statements, déclarations et sélecteurs de méthodes.
`traverseChildren` définit leurs enfants ; `children`, `mapChildren` et
`rewriteBottomUp` en dérivent. `DirectCalls` et `Reuse` utilisent ces parcours,
`Rename` leur ajoute les règles lexicales. Les analyses de contrôle appartiennent
à `ControlFlow`, consommé par `CodeGen` et `Printer`. `Ownership.Workers` utilise
le rendu de `Printer` pour son budget de découpage des branches, une heuristique
en caractères distincte du coût du chunker Java.

## Représentations et invariants à conserver

Le [contrat des représentations](representations.md) détaille les frontières
`Typed`/`TypeApp`, les conversions, les signatures de constructeurs et les
obligations des callbacks et Maps FFI.

- **Fonctions.** L'ABI publique curryfiée utilise `Function<Object, Object>`.
  `JavaTypedAbs` peut porter une preuve Int tout en gardant un argument Java
  `Object`. `JavaIntAbs` utilise `__IntFn`, qui implémente aussi `IntUnaryOperator`.
  Une signature de worker peut, elle, déclarer un paramètre `int`.
- **Initialisation.** `JavaAssign` délègue à `__init$…`. `JavaLazyAssign` possède
  un état et un getter d'initialisation. `DirectCalls` respecte l'ordre des
  déclarations et distingue bindings eager, lazy et appels récursifs saturés.
  Un appel depuis un binding lazy peut survenir avant l'affectation d'un champ
  eager situé plus haut dans le fichier : ce chemin garde le contrôle du champ.
- **Effets.** Un effet différé est construit avant d'être forcé. Extraire son
  corps ou ses captures doit conserver le moment, l'ordre et le nombre d'exécutions.
- **Boucles.** Une cible `JavaContinue` identifie sa boucle. Le printer peut
  émettre un `continue` direct ou passer par `TcoLoop` lorsqu'une frontière de
  méthode l'impose. Les closures conservent les snapshots de leur itération.
- **ADT.** Les champs sont génériques ou primitifs suivant la preuve de type.
  Les constructeurs nullaires ont des holders dédiés. Les classes admises par
  l'analyse d'ownership peuvent avoir des champs mutables pour les workers.
- **Records.** Les formes closes éligibles utilisent des classes immuables
  compatibles avec `Map`; les autres formes gardent le chemin Map. Une annotation
  `TypeApp` ou une queue polymorphe ne prouve pas une forme close.
- **Java brut.** `JavaRaw` est opaque ; `Raw` définit les formes fermées admises
  et le scanner de renommage de compatibilité. Les lectures/écritures/binders
  produits par le compilateur sont structurels, notamment la division/modulo Int.
  Voir le [contrat du texte brut](ast.md#java-brut).

## Runtime et FFI des ports

Le [guide FFI/runtime](ffi-runtime.md) détaille enveloppes curryfiées/Effect,
propriétaires des états, transitions de fibres, synchronisation, durée de vie
des callbacks, conversions d'erreurs et dépendances externes.

### Résolution et forme des fragments

`Ffi.loadForeign` appelle `findFfiFile ".java" [] Nothing moduleName modulePath` dans PBO.
Le [résolveur](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/FfiSupport.js)
essaie le fichier adjacent au `.purs`, puis les racines découvertes dans `.spago`,
`spago.d` et le dossier appelant. Il cherche les variantes de chemin du module
sous `src/` ou à la racine. Le pilote Java ne lui transmet pas de dossier FFI CLI.

`loadForeign` retourne un `Maybe ForeignSource`, contenant le chemin et le texte
lus. Un fragment fournit les membres de la classe générée : champs exportés et
méthodes privées éventuelles, avec noms de types Java qualifiés. `renderForeign`
insère un fragment non vide tel quel, sinon produit des stubs pour les imports
étrangers. Le champ commun `FFI_STUB` est toujours présent. Une erreur de lecture
du fichier sélectionné est propagée avec son chemin. `javac` contrôle ensuite
les références Java ; le backend n'adapte pas automatiquement une signature
Java ordinaire à l'ABI curryfiée.

La présence d'une FFI JavaScript dans un port est compatible avec la présence
d'une FFI Java : elles servent les chemins de compilation et d'exécution respectifs.

### Implémentations à consulter

| Contrat | Emplacement et représentation |
| --- | --- |
| `Effect a` | [Effect.java](../../javapurs-effect/src/Effect.java) : fonctions curryfiées et actions `Supplier`. Certaines primitives ont aussi un rendu intégré au compilateur. |
| Console | [Console.java](../../javapurs-console/src/Effect/Console.java) : bindings Java du port. |
| `Ref a` | [Ref.java](../../javapurs-refs/src/Effect/Ref.java) : cellule `Object[]` d'un élément ; lecture, écriture et modification sont synchronisées sur la cellule. |
| `Aff a` | [Aff.java](../../javapurs-aff/src/Effect/Aff.java) : interpréteur bind/map, annulation à cause unique, inscriptions retirables, fibres daemon, bracket masqué, supervision du sous-arbre et coordination parallèle. |
| `Promise a` | [Promise/Internal.java](../../javapurs-js-promise/src/Promise/Internal.java) : états pending/réglé, adoption et abonnements ; réactions eager trampolinées hors verrous, sans microtasks JS. |
| Pont Promise/Aff | [Promise/Aff.purs](../../javapurs-js-promise-aff/src/Promise/Aff.purs) : pont PureScript vers les deux runtimes précédents. |

Pour une FFI `Effect (Promise a)`, l'effet retourne un objet `PromiseValue` du
module généré `__M$Promise_Internal`. Un Aff suit les opérations de son port et
ne se réduit pas à un `Supplier` arbitraire. Les callbacks, erreurs et annulations
doivent respecter les enveloppes prévues par ces runtimes.

La JVM n'attend pas spontanément les fibres daemon. Les
[suites FFI ciblées](testing.md#runtimes-ffi-et-interopérabilité) attendent la
complétion, propagent les erreurs au processus et exercent le pont réel en
records typés et Maps. Elles couvrent aussi la sélection transitive du port
`javapurs-foreign`, nécessaire à la conversion des rejets.

La couverture Java se vérifie par port et par application. Les JAR et les FFI
applicatives appartiennent à l'application ; le nom d'un dépôt ou la seule
compilation d'une classe ne décrit pas sa couverture fonctionnelle.

## Préparer une modification

1. Identifier la responsabilité et le niveau d'entrée : TAST/PBO, `JavaAst`,
   printer, FFI ou pilote.
2. Lire le contrat et les consommateurs du résultat, notamment lorsque les
   types Java ou les portées changent de représentation.
3. Choisir les lignes pertinentes de la [matrice de tests](testing.md#matrice-des-tests).
4. Pour un refactoring de génération, conserver les mêmes entrées, options,
   versions et FFI lors de la comparaison des sources Java.
5. Mettre à jour le contrat et consigner les preuves ciblées dans le registre.

Le [plan de travail actif](../../todo.md) donne les lots et leurs critères de
fin. Les [preuves M01–M11](testing.md#validation-m11) clôturent le plan v1 de
maintenabilité. La matrice décrit les vérifications par responsabilité ; elle sert à
sélectionner les contrôles adaptés à chaque changement.
