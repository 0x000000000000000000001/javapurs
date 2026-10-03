# Impression Java et runtime généré

Le printer reçoit l'[AST Java](ast.md) après traduction, renommage et chunking.
Il transforme cet IR mixte en texte Java. Les positions valides restent un
contrat des producteurs : `JavaExpr` contient aussi des statements, déclarations
et sélecteurs qui ne peuvent pas être employés comme des valeurs ordinaires.

## Trouver la bonne responsabilité

| Module | Responsabilité |
| --- | --- |
| [Printer](../src/Javapurs/Printer.purs) | Dispatcher exhaustif, expressions, statements et sélection du renderer de chaque famille. `printExpr` et `printFile` sont les entrées existantes. |
| [Printer.Syntax](../src/Javapurs/Printer/Syntax.purs) | Chaînes Java, listes, séquences, enveloppes `Supplier`, types des paramètres, casts de champs ADT et déballage Int partagé avec les records. |
| [Printer.Body](../src/Javapurs/Printer/Body.purs) | Plan du corps, retours, scopes terminaux, boucles, caches, sauts directs et repli `TcoLoop`. |
| [Printer.Declarations](../src/Javapurs/Printer/Declarations.purs) | Initialisations eager/lazy, méthodes statiques, classes d'ADT et holders des singletons. |
| [RecordPrinter](../src/Javapurs/RecordPrinter.purs) | Déclarations des records, lecteurs, vue Map, construction et mise à jour avec repli. |
| [Runtime](../src/Javapurs/Runtime.purs) | Templates des trois fichiers communs et des cinq implémentations globales intégrées. |
| [Emit](../src/Javapurs/Emit.purs) | Assemblage du module avec sa FFI et choix des noms ; staging/publication délégués à [Output](../src/Javapurs/Output.purs). |

Les sous-renderers reçoivent `Render = JavaExpr -> String` en argument. Ils
rendent leurs enfants par ce callback, sans importer le dispatcher et sans
créer de cycle entre modules. Les analyses des sauts restent dans `ControlFlow` ;
la reconnaissance des boucles comptées reste dans `CountedLoops`.

Le guide des [représentations](representations.md) relie les preuves de type aux
conversions : marqueurs de stockage, type Java effectif, callbacks génériques/Int
et admission des chemins rapides de `RecordPrinter.fieldStorage`.

## Expressions, statements et déclarations

`Printer.printExpr` conserve son nom et son interface de compatibilité. Il traite
les trois familles dans des sections distinctes :

- **Expression :** produit une valeur Java sans point-virgule final. Un bloc, une
  boucle ou une exception utilisés comme valeur nécessitent un `Supplier` appelé
  immédiatement, car Java n'a pas d'expression-bloc générale.
- **Statement :** inclut son terminateur ou ses accolades. Une déclaration locale
  ne force pas ses initialiseurs à devenir statements : ils passent encore par
  le renderer d'expression. `JavaIf` contient deux séquences de statements.
- **Déclaration :** délègue à `Printer.Declarations`. Les paramètres de workers
  utilisent `JavaParamType` ; les champs publics des modules restent `Object`.

Les sélecteurs `JavaStaticMethodRef` et `JavaInstanceMethodRef` appartiennent
uniquement au callee d'un `JavaCall`. Le printer ne les transforme pas en valeurs
de fonction. `JavaRaw` est inséré tel quel ; son contrat d'opacité est défini
dans [Java brut](ast.md#java-brut).

## Choisir le corps avant de produire son texte

`Printer.Body.planBody` retourne l'une des quatre formes nommées de `BodyPlan` :

| Plan | Admission et rendu |
| --- | --- |
| `InlineLoop` | Boucle directement dans un corps `MethodBody` : le stockage, les caches et le `while` occupent ce corps. |
| `TailStatements` | Une branche du chemin de résultat contient des scopes à statements : les ternaires deviennent des `if`, avec retours dans chaque bras. |
| `BlockReturn` | Bloc racine ordinaire : statements puis `return` de son résultat. |
| `ExpressionReturn` | Retour de l'expression, avec son enveloppe éventuelle. |

`branchNeedsStatements` et `bodyNeedsTail` sont des décisions de disposition.
Elles suivent les **résultats**, pas les conditions et initialiseurs. Les analyses
`ControlFlow` répondent séparément aux questions de contrôle.

Les conventions d'appel choisissent le mode :

| Site | Mode / résultat |
| --- | --- |
| Fonction curryfiée non vide, abstraction typée publique, worker statique | `MethodBody`, résultat `Object`. |
| `JavaAbs []` | `SupplierBody`, résultat `Object` différé jusqu'à `get()`. |
| `JavaIntAbs` | `printIntBody` : expression Int, ou statements suivis du résultat converti en `int`. |
| Initialiseur global eager | Méthode `__init$…` qui retourne son expression ; ne force pas une action stockée. |

Le mode `SupplierBody` conserve une boucle racine comme **expression retournée**
dans `get()`. La création du `Supplier` reste différée et chaque appel recommence
la boucle. Le renderer ne supprime pas cette frontière en la confondant avec une
méthode de fonction. De même, un `JavaLet`/`JavaLetRec` n'est pas systématiquement
aplati : seuls les chemins admis par le plan terminal le deviennent.

`Printer.Syntax.supplier` reçoit un corps Java complet, accolades comprises,
et crée l'action. `forceSupplier` lui ajoute `.get()`. Le nom explicite distingue
la construction différée de l'exécution immédiate. `JavaFunction` conserve aussi
son enveloppe lambda `Supplier`, dont le corps est une expression.

## Un parcours terminal partagé

`printTail` traite les branches, blocs, lets et groupes récursifs avec un
`TailContext` : `FunctionTail` ou `LoopTail`. Les scopes utilisent le même rendu,
mais seul `LoopTail` peut choisir un `continue` direct.

- Une cible identique à la boucle active, à l'arité exacte, permet
  `printParallelContinue`. Tous les nouveaux arguments sont évalués dans des
  temporaires **avant** d'affecter le stockage. Échanges, captures et exceptions
  voient donc les valeurs de l'ancienne itération.
- Un saut vers une autre cible, ou rendu en position expression, utilise
  `TcoLoop`. Chaque `catch` compare l'identité et relance les sauts destinés à un
  parent. Les exceptions ordinaires ne sont pas interceptées par ce mécanisme.
- Une closure constitue toujours une frontière de méthode : le parcours terminal
  n'entre pas dans son corps pour continuer la boucle appelante.

Le record `Loop` nomme identité, paramètres, paramètres Int, caches et corps.
`countedPlan` admet un plan `CountedLoop` seulement si son étape cible cette
boucle. Le chemin compté protège les compteurs négatifs ; le `while` générique
conserve leur comportement après débordement Int.

Les `IntSupplier` d'invariants sont alloués par invocation complètement appliquée.
Ils évaluent au premier usage et ne deviennent prêts qu'après une évaluation
réussie. Les snapshots finaux de chaque itération restent distincts du stockage
mutable. Les noms sont partagés avec `Naming` et `Rename`.

`printLetRecBindings` émet un objet de scope dont tous les champs existent avant
leurs initialisations. Les noms déjà rendus uniques par `Rename` permettent de
placer plusieurs classes de scope dans une même méthode Java.

## Déclarations et records

Les initialiseurs eager ont chacun une méthode pour limiter la taille de
`<clinit>`. Les getters lazy utilisent les états 0/1/2 et signalent une
initialisation récursive. Leurs champs de cache n'ont pas d'initialiseur explicite :
un getter appelé plus tôt peut les avoir remplis pendant une entrée réentrante.

Une classe d'ADT peut avoir des champs mutables pour un worker ownership.
Lorsqu'elle contient un champ Int, le constructeur typé est accompagné d'un
constructeur `Object...` : Java considère ce dernier après les signatures exactes,
ce qui conserve l'ABI sans ambiguïté sur les littéraux primitifs. Un constructeur
nullaire a son propre holder, indépendant de l'ordre des champs du module.

`RecordPrinter` sépare déclaration de forme, lecteurs typés et méthodes Map.
Pour construire un record, les valeurs sont liées à des temporaires dans l'ordre
source avant le réordonnancement des arguments et leurs casts. La mise à jour
évalue la base, prend le snapshot du repli Map, puis évalue les remplacements.
Elle choisit ensuite la copie typée ou la Map ; la dernière mise à jour d'un label
gagne. Le rendu partage `quote`, `comma` et `forceSupplier` avec le printer général.

## Échappement et templates

`Printer.Syntax.quote` est l'unique production de littéraux String dans ces
renderers. `escapeJavaString`, également réexporté par `Printer`, échappe les
unités UTF-16 : guillemets, backslashes, contrôles, Unicode et substituts isolés.
Il protège aussi une séquence textuelle telle que `\u000a` du prétraitement Unicode
de Java. Messages d'exception, identités `TcoLoop` et labels de records utilisent
le même contrat.

Les noms Java de variables/classes/méthodes sont déjà préparés par leurs
producteurs : ils ne sont pas des contenus de littéraux String.

Les fichiers `__IntFn.java`, `TcoLoop.java` et `MainRun.java` proviennent de
`Runtime`. `builtinGlobalSource` contient les substitutions historiques de
`Effect_Console.log`, `Test_Assert.assertImpl`, `Effect.bindE`, `Effect.pureE` et
`Data_Semigroup.concatString`. Il retourne `Nothing` pour les autres lectures,
qui conservent leur champ global. Le nom de module fourni à cette table est celui
sans préfixe généré `__M$`. La lecture/insertion des autres fragments FFI reste
dans `Ffi`/`Emit`.

## Vérification

[test/printer.mjs](../test/printer.mjs) compile pour Java 17 puis réalise
**86 contrôles JVM** : corps de méthodes/closures/thunks, boucles directes et
différées, builtins, chaînes et labels Map/records typés, messages d'exception et
cibles à échapper. Les résultats textuels attendus sont reconstruits à partir
de codes UTF-16 dans le harness, indépendamment du renderer.

Les suites TCO, boucles comptées, invariants, scopes et chunking couvrent les
frontières terminales plus complexes. Les suites de déclarations, records et
fonctions couvrent leurs ABI. Voir la [matrice](testing.md#matrice-des-tests) et
les [preuves M07](testing.md#validation-m07).
