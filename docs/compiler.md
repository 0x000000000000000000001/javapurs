# Guide du compilateur Javapurs

État documenté au **1er octobre 2026**. Ce guide décrit le chemin de production
actuel. Les références des sources et des outils figurent dans le
[registre de validation](testing.md#validation-m01).

## Se repérer dans le workspace

```text
htdocs/
├── purescript/                             fork du frontend et du TAST
├── purescript-backend-optimizer-javapurs/   dépendance locale PBO
├── javapurs/
│   ├── todo.md                            plan de maintenabilité du workspace
│   ├── javapurs/                          dépôt de ce guide
│   │   ├── bin/                           lancement, build et runners
│   │   ├── src/Main.purs                   orchestration
│   │   ├── src/Javapurs/                   traduction, analyses, AST et rendu
│   │   ├── test/                          régressions directes Node/Java
│   │   ├── tests/runner/                   workspace des fixtures PureScript
│   │   └── tools/                         sélection et processus des ports
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
| Application : `java_output/` | Javapurs écrit les classes de modules, helpers, FFI insérée et launcher. |
| Répertoire passé à `javac -d` | `javac` produit les `.class` exécutés par la JVM ; le backend ne choisit pas cette destination. |

Le nom `output/` désigne donc le build de l'outil quand on travaille dans son
dépôt, et l'entrée TAST quand on lance cet outil depuis une application.
Reconstruire l'outil après modification de ses sources ou de PBO :
[bin/javapurs.js](../bin/javapurs.js) importe directement le `Main` déjà construit.

## Suivre une compilation

### 1. Entrée et configuration

[bin/javapurs](../bin/javapurs) démarre Node avec `--expose-gc`, une pile de
65 536 Kio et un heap maximal de `JAVAPURS_HEAP` Mio, 16 384 par défaut.
`bin/javapurs.js` appelle ensuite [Main.main](../src/Main.purs).

`Main` lit les arguments avec `Node.Process.argv`. La
[table des options](../README.md#compiler-options) correspond à ce parseur.
Les chemins d'entrée `output` et de sortie `java_output` sont relatifs au dossier
appelant. L'appelant prépare `java_output` ; les options de sortie et de FFI
du parseur générique de PBO ne sont pas utilisées par ce pilote.

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
`TypeApp` n'est pas à lui seul le type du résultat : voir
[RecordShapes.recordShapeOf](../src/Javapurs/RecordShapes.purs) et
[IntFunctions.applyFunction](../src/Javapurs/IntFunctions.purs).

`Main` charge les directives par défaut et appelle le builder séquentiel
`buildModules`, avec les sémantiques étrangères communes et une limite de
réécriture de 10 000. Il fournit les hooks de préparation, cache et émission.
Le hook `onSkipModule` renvoie actuellement `Nothing` : la présence de `.purmeta`
ne constitue pas un cache des fichiers Java émis par Javapurs.

Points d'entrée PBO : [App](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/App.purs),
[Builder](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/Builder.purs),
[CoreFn](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/CoreFn.purs).

### 3. Traduction d'un module

Dans `onCodegenModule`, `Main` résout d'abord la FFI Java, puis appelle
`CodeGen.translateWithIntFunctions`. Cette entrée coordonne, dans l'ordre :

1. `Ownership.prepare`, si activé : sélection des fonctions consommatrices,
   réécriture du module, déclarations de workers et classes rendues mutables.
2. Analyse TCO des bindings, puis `RecordTypes.annotateRecordTypes`.
3. `FunctionTypes.annotateFunctionTypes`, si les fonctions Int sont activées.
4. Traduction des expressions, fonctions, bindings récursifs et branches.
   `translateLoop` prépare les invariants et les paramètres Int lorsque les
   conditions de contrôle le permettent.
5. Déclarations des classes d'ADT depuis `dataDecls`, collecte des formes de
   records et assemblage d'un `JavaFile`.
6. `DirectCalls.directCalls`, si activé, puis `Reuse.reuseConstructors`.

Le résultat contient `decls` et `recordShapes`. Les entrées simplifiées comme
`translate` ou `translateWithRecords` donnent des valeurs par défaut aux
options supplémentaires. Elles ne réalisent pas les étapes suivantes de `Main`.

### 4. Noms lexicaux puis découpage

`Main` applique `Rename.renameExpr` aux déclarations, puis `Chunk.chunkFile`,
sauf avec `--no-chunk`. **Cet ordre est un contrat de la passe.**

- `Rename` distingue les bindings homonymes par des suffixes `$rN` et restaure
  l'environnement à la sortie des blocs, lambdas et branches.
- `Chunk` décide quelles valeurs peuvent devenir des méthodes `__chunk$N`.
  Les variables libres deviennent des paramètres avec leur type Java effectif.
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
attribuer. Voir [Chunk](../src/Javapurs/Chunk.purs) et ses
[régressions ciblées](testing.md#chunker-et-bigfunction).

### 5. Rendu, FFI et écritures

`Printer.printExpr` rend les déclarations du fichier découpé. `RecordPrinter`
rend les classes de records. `Main` assemble les membres Java avec le fragment
FFI ou les stubs, puis écrit la classe du module.

| Fichier généré | Responsabilité actuelle |
| --- | --- |
| `__M$App_Main.java` pour `App.Main` | `Naming.modulePrefix`, puis assemblage dans `Main`. |
| `__Record$….java` | Nom structurel dans `RecordShapes`, corps dans `RecordPrinter`. |
| `__IntFn.java` | `IntFunctions.runtimeSource`, écrit pendant la préparation. |
| `TcoLoop.java` | Template dans `Main`, écrit dans le callback de chaque module. |
| `MainRun.java` | Template dans `Main`, émis pour le module sélectionné par `--main`. |

Les classes utilisent le package Java par défaut. `__M$Main` représente le module
PureScript `Main` ; `MainRun` est l'entrée JVM. Les constructeurs sont des classes
imbriquées, par exemple `__M$Data_Maybe.Just`. Les noms de fichiers contenant `$`
doivent être entourés de quotes simples lorsqu'ils apparaissent littéralement
dans une commande shell, par exemple `'__M$Main.java'`.

`--main` sélectionne le launcher parmi les modules chargés. Le pilote ne filtre
pas les modules chargés par atteignabilité depuis ce point d'entrée. Il ne retire
pas non plus les sorties de modules supprimés ou renommés.

### 6. Compilation et exécution Java

L'appelant lance `javac`, fournit les JAR éventuels et choisit la cible de
bytecode. `MainRun` lit le champ `main` du module et exécute un `Supplier` par
`get()` ou une `Function` par `apply(null)`.

Les commandes minimales et le classpath sont dans le
[README](../README.md#compile-and-run-an-application). Pour b8x, les scripts
[build](../../../b8x/bin/build) et [_javapurs](../../../b8x/bin/_javapurs)
emploient les records Maps, `javac --release 17` et les JAR de
`run/bak/java/lib/`. Ce sont des choix d'intégration applicative.

## Où se trouve une responsabilité ?

| Question | Sources à lire |
| --- | --- |
| Comment sont pilotées les phases et les durées ? | [Main](../src/Main.purs), [Metrics](../src/Javapurs/Metrics.purs). |
| Comment sont nommés modules, constructeurs et locaux ? | [Naming](../src/Javapurs/Naming.purs), [Rename](../src/Javapurs/Rename.purs). |
| Quels nœuds Java existent et quels sont leurs enfants ? | [JavaAst](../src/Javapurs/JavaAst.purs). |
| Comment sont traduits applications, effets, bindings et branches ? | [CodeGen](../src/Javapurs/CodeGen.purs), [Operators](../src/Javapurs/Operators.purs). |
| Quand un paramètre ou une fonction devient-il primitif ? | [IntLoops](../src/Javapurs/IntLoops.purs), [FunctionTypes](../src/Javapurs/FunctionTypes.purs), [IntFunctions](../src/Javapurs/IntFunctions.purs). |
| Quels calculs peuvent être mis en cache dans une boucle ? | [PureInvariants](../src/Javapurs/PureInvariants.purs), [LoopInvariants](../src/Javapurs/LoopInvariants.purs). |
| Quand utilise-t-on un worker statique ou un constructeur existant ? | [DirectCalls](../src/Javapurs/DirectCalls.purs), [Reuse](../src/Javapurs/Reuse.purs). |
| Quelle preuve autorise la consommation d'un arbre ? | [Ownership](../src/Javapurs/Ownership.purs). |
| Quels records peuvent avoir une classe spécialisée ? | [RecordTypes](../src/Javapurs/RecordTypes.purs), [RecordShapes](../src/Javapurs/RecordShapes.purs). |
| Pourquoi une expression est-elle extraite dans un helper ? | [Chunk](../src/Javapurs/Chunk.purs). |
| Comment sont rendus blocs, boucles, classes et records ? | [Printer](../src/Javapurs/Printer.purs), [CountedLoops](../src/Javapurs/CountedLoops.purs), [RecordPrinter](../src/Javapurs/RecordPrinter.purs). |

`JavaExpr` représente actuellement expressions, statements et déclarations.
`children` est un parcours structurel de lecture ; il ne modélise pas les portées.
Les passes de réécriture et les analyses lexicales ont leurs règles propres.
`CodeGen` importe encore des analyses de contrôle de `Printer`, et `Ownership`
utilise aussi son rendu : ces dépendances font partie de l'organisation actuelle.

## Représentations et invariants à conserver

- **Fonctions.** L'ABI publique curryfiée utilise `Function<Object, Object>`.
  `JavaTypedAbs` peut porter une preuve Int tout en gardant un argument Java
  `Object`. `JavaIntAbs` utilise `__IntFn`, qui implémente aussi `IntUnaryOperator`.
  Une signature de worker peut, elle, déclarer un paramètre `int`.
- **Initialisation.** `JavaAssign` délègue à `__init$…`. `JavaLazyAssign` possède
  un état et un getter d'initialisation. `DirectCalls` respecte l'ordre des
  déclarations et distingue bindings eager, lazy et appels récursifs saturés.
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
- **Java brut.** `JavaRaw` contient du texte sans métadonnées lexicales complètes.
  `Rename` traite les identifiants connus ; le chunker ne reconnaît comme fermées
  que certaines formes. Les conditions d'admission doivent respecter cette limite.

## Runtime et FFI des ports

### Résolution et forme des fragments

`Main` appelle `findFfiFile ".java" [] Nothing moduleName modulePath` dans PBO.
Le [résolveur](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/FfiSupport.js)
essaie le fichier adjacent au `.purs`, puis les racines découvertes dans `.spago`,
`spago.d` et le dossier appelant. Il cherche les variantes de chemin du module
sous `src/` ou à la racine. Le pilote Java ne lui transmet pas de dossier FFI CLI.

Un fragment fournit les membres de la classe générée : champs exportés et
méthodes privées éventuelles, avec noms de types Java qualifiés. `Main` l'insère
tel quel. En l'absence d'un fragment non vide, il produit des stubs pour les
imports étrangers. `javac` contrôle ensuite les références Java ; le backend
n'adapte pas automatiquement une signature Java ordinaire à l'ABI curryfiée.

La présence d'une FFI JavaScript dans un port est compatible avec la présence
d'une FFI Java : elles servent les chemins de compilation et d'exécution respectifs.

### Implémentations à consulter

| Contrat | Emplacement et représentation |
| --- | --- |
| `Effect a` | [Effect.java](../../javapurs-effect/src/Effect.java) : fonctions curryfiées et actions `Supplier`. Certaines primitives ont aussi un rendu intégré au compilateur. |
| Console | [Console.java](../../javapurs-console/src/Effect/Console.java) : bindings Java du port. |
| `Ref a` | [Ref.java](../../javapurs-refs/src/Effect/Ref.java) : cellule `Object[]` d'un élément ; lecture, écriture et modification sont synchronisées sur la cellule. |
| `Aff a` | [Aff.java](../../javapurs-aff/src/Effect/Aff.java) : `AffRun`, `RunContext`, pile de binds trampolinée et `NativeFiber` sur thread Java daemon. Annulation vérifiée par le contexte ; délais découpés en tranches. |
| `Promise a` | [Promise/Internal.java](../../javapurs-js-promise/src/Promise/Internal.java) : `PromiseValue` avec état, résultat ou rejet. Les combinateurs traitent les valeurs résolues de manière eager, sans file de microtasks JS. |
| Pont Promise/Aff | [Promise/Aff.purs](../../javapurs-js-promise-aff/src/Promise/Aff.purs) : pont PureScript vers les deux runtimes précédents. |

Pour une FFI `Effect (Promise a)`, l'effet retourne un objet `PromiseValue` du
module généré `__M$Promise_Internal`. Un Aff suit les opérations de son port et
ne se réduit pas à un `Supplier` arbitraire. Les callbacks, erreurs et annulations
doivent respecter les enveloppes prévues par ces runtimes.

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

Le [plan de maintenabilité](../../todo.md) donne les lots et leurs critères de
fin. La matrice décrit les vérifications par responsabilité ; elle sert à
sélectionner les contrôles adaptés à chaque changement.
