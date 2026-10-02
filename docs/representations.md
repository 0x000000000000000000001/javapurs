# Types, représentations et conventions d'appel

Une annotation PureScript décrit une valeur ; elle ne fixe pas à elle seule le
type Java de chaque variable qui la transporte. Le backend choisit séparément
**la preuve utilisable**, **le stockage** et **la convention d'appel**. Ce guide
relie ces décisions à leurs producteurs et à leurs replis.

## De la source au type Java

| Étape | Information produite ou consommée |
| --- | --- |
| Frontend PureScript | Le typage et [CoreFn.Desugar](../../../purescript/src/Language/PureScript/CoreFn/Desugar.hs) attachent types et métadonnées au CoreFn enrichi. |
| Sérialisation TAST | [CoreFn.ToJSON](../../../purescript/src/Language/PureScript/CoreFn/ToJSON.hs) écrit `typeTable`, les indices `type` des annotations, `dataDecls` et `classDecls` dans `output/<Module>/corefn.json`. |
| Décodage PBO | [CoreFn.Json](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/CoreFn/Json.purs) et [TypeTable](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/CoreFn/TypeTable.purs) reconstruisent `Ann.type :: Maybe ExprType`, les champs d'ADT et les types structurels. Une annotation absente reste `Nothing`. |
| Conversion PBO | [Convert.toBackendExprWithType](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/Convert.purs) choisit l'annotation de l'expression, puis le type fourni par le binding, puis son inférence limitée ; le résultat devient `Typed ty expression`. `ExprTypeApp` devient séparément `BackendSyntax.TypeApp`. |
| Optimisation / TCO | Les transformations peuvent conserver la signature d'une fonction tout en laissant des usages locaux sans annotation. `Tco.analyze` fournit aussi les rôles de boucle/join. |
| Récupération Java | [RecordTypes](../src/Javapurs/RecordTypes.purs), puis [FunctionTypes](../src/Javapurs/FunctionTypes.purs) si les fonctions Int sont activées, propagent les preuves admises avant la traduction. |
| Choix de représentation | [Representation](../src/Javapurs/Representation.purs), [IntFunctions](../src/Javapurs/IntFunctions.purs) et [RecordShapes](../src/Javapurs/RecordShapes.purs) sélectionnent les marqueurs et nœuds Java. |
| Déclaration / rendu | [Printer](../src/Javapurs/Printer.purs), [Declarations](../src/Javapurs/Printer/Declarations.purs) et [RecordPrinter](../src/Javapurs/RecordPrinter.purs) matérialisent types, conversions et ABI. |

`dataDecls` fournit le **layout déclaré** des constructeurs. Une application
`Box Int` ne change pas un champ déclaré `a` en champ `int`. `classDecls` sert à
PBO ; la couche Java n'en déduit pas une disposition de dictionnaire permettant
de supprimer arbitrairement des binders de contraintes.

## Ce qui constitue une preuve

[TypeEvidence](../src/Javapurs/TypeEvidence.purs) contient les projections partagées,
pas un nouveau moteur d'inférence :

- `declaredType` lit uniquement le `Typed` extérieur de l'expression examinée.
- `applyArguments` consomme un préfixe de flèches ; `argumentType` projette le
  prochain paramètre. `Func [Int, Int] Int` et `Func [Int] (Func [Int] Int)`
  peuvent tous deux laisser une flèche `Int -> Int` après un argument.
- `bindArgumentTypes` associe ces types aux identités lexicales `localId`.
  Un binder inconnu masque aussi une ancienne preuve portant le même identifiant.
- `recordProperty` projette une propriété connue, même dans une ligne ouverte.
  Cela prouve le type de la propriété, pas l'admissibilité du layout extérieur.
- `intFunction` reconnaît exactement `Func [Int] Int`.

Les projections de flèche s'arrêtent sur `ForAll`, `ConstrainedType`,
`ExprType.TypeApp`, `Any` ou un `Func []` sans paramètre consommable. En particulier,
retirer les contraintes avant d'aligner les paramètres ferait prendre un
dictionnaire pour le premier argument métier.

### Trois formes à distinguer

```text
Typed (Func [Int] Int) f    type du résultat f : utilisable pour un appel Int
TypeApp f Int              argument de type fourni à f : pas sa signature
ExprType.TypeApp t [Int]   application dans le langage des types : pas un Func
```

Un `Typed` explicite autour d'un `TypeApp` peut typer **l'usage**. Il ne réécrit
pas la définition polymorphe ni ses binders. `CodeGen.Expr` efface `TypeApp`
en traduisant son enfant ; `translateTypedFunction` n'admet qu'un `Func`
directement associé à une abstraction ordinaire non vide. Il ne traverse pas
une instantiation pour en spécialiser la lambda d'origine.

De même, `Typed Int (f x)` décrit le résultat de l'appel, pas le type de `f` ou
de `x`. `CodeGen.Syntax.flattenApp` conserve les preuves de la tête réelle ; une
annotation autour d'un préfixe déjà appliqué ne peut pas être déplacée sur elle.

### Qui propage quoi ?

| Passe | Origine et propagation admises | Limite / repli |
| --- | --- | --- |
| `RecordTypes` | Signatures de paramètres, `Typed`, bindings locaux, propriétés, littéraux scalaires et quelques primitives Int. Une mise à jour recalcule le type des champs remplacés ; la dernière occurrence d'un label prime. | Pas d'inférence globale des résultats d'appels. Type de remplacement inconnu ou label absent : pas de nouvelle preuve de record. |
| `FunctionTypes` | Types déclarés des globals du module courant, environnement lexical, résultats résiduels des applications, propriétés et branches dont les types connus concordent. Les signatures fournissent aussi des types attendus aux lambdas locales, arguments et résultats. | Le type connu prime sur le type attendu. Pas de spécialisation rétroactive d'un binder depuis ses appels, ni de recherche des signatures dans les autres modules ; une annotation importée explicite reste utilisable. |
| `IntLoops` | Annotation Int sur un local direct, ou usage direct de ce local comme opérande d'une primitive Int. | Un argument passé à une fonction ou un `TypeApp` ne prouve pas le type du binder. L'analyse reste distincte des projections de flèches. |

Les deux premières passes partagent les opérations lexicales et les projections
de `TypeEvidence`, tout en conservant leurs règles de propagation propres.
Les exports historiques `FunctionTypes.intFunction` et
`CodeGen.Syntax.paramKinds` restent des réexports.

## Stockage et conversions scalaires

`Representation.parameterType` sélectionne `ParamInt` pour un **Int exact**,
`ParamObject` pour les autres types. `JavaParamType` décrit un emplacement de
déclaration, et non le type statique de tout usage de cette valeur.

| Emplacement Java | Type effectif / conversion |
| --- | --- |
| Champ public de module, résultat d'un worker, paramètre d'une closure générique | `Object`. Les primitives sont boxées par Java à cette frontière. |
| `JavaTypedAbs` avec `ParamInt` | Toujours `Object` dans la closure publique ; le marqueur autorise un worker ultérieur à déclarer `int`. |
| Paramètre `ParamInt` d'une méthode statique | `int` ; les appels directs et ownership utilisent `Representation.coerceArgument`, qui place `JavaCast "int"` au site de l'argument. |
| `JavaIntAbs` | Paramètre et résultat `int` via `__IntFn.applyAsInt`. Le retour est converti par `Printer.Body.printIntBody`. |
| Local initialisé par un `Typed Int` direct | `JavaIntLocalAssign`, donc `int`, avec cast de l'initialiseur. |
| Champ d'ADT déclaré Int | `int` ; les autres champs, y compris `Number`, `Boolean`, `Char`, tableaux et variables de type, restent `Object`. |
| Littéral / opérateur | Les opérations peuvent produire un `int`, `double` ou `boolean` avant boxing ; cette propriété ne change pas l'ABI publique. |

Les captures de [Chunk](chunking.md) suivent le **type Java effectif** : un binder
`JavaTypedAbs` est `Object`, un binder `JavaIntAbs` est `int`, de même que les
snapshots Int de boucle. Une méthode extraite retourne encore `Object` ; son
appel est reconverti lorsque le site consommateur exige une primitive.

Deux conversions intentionnelles sont visibles dans
[Printer.Syntax](../src/Javapurs/Printer/Syntax.purs) :

- `assignField` émet un cast `((int) (value))` pour un emplacement `ParamInt` ;
  l'expression peut déjà être primitive ou être transportée dans `Object`.
- `unboxInt` émet `((Integer) (value)).intValue()` quand la source est déjà
  stockée comme `Object` : lecture Map, local de champ de record ou tableau
  `Object...` d'un constructeur. `null` échoue au déballage, un mauvais wrapper
  au cast. Ce n'est pas une conversion générale `Number.intValue()`.

### Constructeurs d'ADT

`CodeGen` lit les types des champs dans `dataDecls`, via `parameterType`.
`Printer.Declarations.printClass` produit :

1. Un constructeur dont les arguments correspondent au stockage (`int`/`Object`).
2. S'il existe au moins un champ Int, un overload `Object...` pour les appels
   génériques/FFI ; chaque Int y est déballé explicitement. Le constructeur fixe
   est prioritaire dans la résolution Java, ce qui évite l'ambiguïté des littéraux.
3. Pour un constructeur nullaire, un holder `__singleton$…` indépendant de
   l'initialisation des champs publics du module.

Les champs sont `final`, sauf les classes autorisées par `Ownership`.
`CtorDef` expose une chaîne curryfiée générique ; `CtorSaturated` alloue la classe
directement, ou lit le singleton sans champ. Une FFI doit respecter l'arité et
les types de stockage déclarés ; elle peut fournir des arguments boxed à
l'overload générique. Les `newtype` sont effacés par la conversion PBO.

## Fonctions Int et convention publique

`IntFunctions.abstractFunction` consomme une flèche par binder. Le suffixe exact
`Int -> Int` devient `JavaIntAbs`. Un paramètre Int dont le résultat n'est pas
Int devient `JavaTypedAbs` ; les autres binders restent `JavaAbs`.

Pour les fonctions récursives globales, `Representation.paramKinds` exige que le
`Func` extérieur couvre **exactement** l'arité extraite. Cette règle est plus
restrictive que la consommation successive des flèches : on ne traverse pas les
annotations des lambdas imbriquées pour inventer la signature du worker aplati.
En cas de doute, ses paramètres restent `Object`.

| Appel | Convention |
| --- | --- |
| `JavaApply` | Cast vers `Function<Object,Object>`, puis `apply(Object)` ; résultat `Object`. |
| `JavaIntApply` | Cast vers `Function<Object,Object>`, `__IntFn.from`, puis `applyAsInt(int)` ; résultat `int`. |
| Worker direct admis | Méthode privée statique, arguments selon `JavaParamType`, résultat `Object`. Les gardes d'initialisation restent du ressort de `DirectCalls`. |
| Saut terminal admis | Réaffectation des paramètres de boucle ou signal `TcoLoop` ; ce choix de contrôle précède l'application ordinaire. |

[Runtime.intFunctionSource](../src/Javapurs/Runtime.purs) fait de `__IntFn` à la fois
une `Function<Object,Object>` et une `IntUnaryOperator`. Le bridge `apply`
déballera l'argument et boxera le résultat. `__IntFn.from` :

- conserve une instance `__IntFn` ;
- adapte une `Function` étrangère ordinaire au moment de l'appel ;
- conserve `null`, de façon à évaluer l'argument avant l'échec d'invocation ;
- ne force pas le corps du callback lors de l'adaptation.

Un callback conservé dans une closure ou un record n'est donc pas adapté lors de
sa capture. La FFI peut fournir une `Function<Object,Object>` retournant un
`Integer`. Une simple `IntUnaryOperator` n'est pas suffisante : le site d'appel
commence par un cast vers `Function`.

`applyFunction` tient aussi compte de `boxedArity` : le préfixe saturé d'une
fonction récursive globale garde l'ABI générique de sa boucle. Après ce préfixe,
une closure retournée peut encore utiliser la flèche Int résiduelle. Cette garde
évite notamment des adaptations répétées des appels récursifs de Fibonacci.

## Records et compatibilité Map

`RecordShapes.recordShape` admet uniquement `Record (Row fields Nothing)` :
labels uniques, tri canonique et nom de classe encodé de **180 caractères au
maximum**. Ligne ouverte, queue inconnue, doublon ou nom trop long : repli Map.
Les noms encodent les labels UTF-16 et les catégories de stockage, sans hash.

`Representation.recordFieldType` choisit le stockage ; `RecordPrinter.fieldStorage`
regroupe, pour chaque catégorie, déclaration, conversion depuis `Object` et test
de compatibilité des mises à jour :

| Preuve du champ | Stockage | Conversion / admission |
| --- | --- | --- |
| `Int` exact | `int` | `unboxInt` ; un nouvel objet doit être un `Integer`. |
| `Record _`, même ouvert | `Map<String,Object>` | Cast Map ; `null` est admis. Aucune copie ou conversion récursive de layout. |
| Autre | `Object` | Identité ; toute valeur est admise. |

La classe générée étend `AbstractMap<String,Object>`. Ses champs sont immuables ;
la vue Map boxe les champs Int et conserve l'ordre des clés de la construction,
indépendamment du tri canonique du layout.

| Opération | Chemin spécialisé et repli |
| --- | --- |
| Construction | Évaluer tous les champs une fois, dans l'ordre source, puis les convertir/réordonner pour le constructeur. Si les labels ne correspondent pas exactement à la forme, construire une `LinkedHashMap`. |
| Lecture | Sur la classe attendue, lire le champ ; sinon faire `Map.get` puis convertir. Une autre forme générée et une Map FFI sont donc acceptées. Un label absent du layout utilise directement la lecture Map. |
| Mise à jour | `CodeGen.Expr` exige une forme résultante identique à celle de la cible. Le renderer exige ensuite une instance de la classe attendue et des remplacements compatibles ; il crée une copie typée fraîche. |
| Repli de mise à jour | Copier la Map et appliquer les remplacements dans l'ordre. Les clés inconnues et leurs valeurs sont préservées. Une Map FFI est copiée **avant** l'évaluation des remplacements, même si ceux-ci mutent la Map d'origine. |

La preuve statique ne promet pas que la valeur FFI est une instance de la classe
générée. Les lecteurs acceptent les Maps ordinaires ; la FFI doit fournir les
labels et valeurs annoncés par sa signature. La construction et les lectures
typées font confiance aux types des champs, tandis que les mises à jour ont un
test dynamique et un repli pour les changements de type.

## Options et vérification

`--int-functions=off` coupe la récupération des types de fonction et les nœuds
`JavaIntAbs`/`JavaIntApply` correspondants. Il ne rend pas tous les calculs Java
boxed : champs Int d'ADT, locaux annotés, boucles Int et signatures récursives
peuvent encore utiliser `int`. `--records=maps` coupe les layouts de records et
leurs opérations spécialisées. `--direct-calls=off` coupe les workers directs.
Ces options sont indépendantes.

Après `./bin/build`, [test/representations.mjs](../test/representations.mjs)
exécute la même fixture sur les huit combinaisons : 43 contrôles JVM par mode,
avec `javac --release 17`. Elle vérifie les layouts d'ADT, wrappers, identités,
constructeurs génériques, flèches imbriquées/partielles, dictionnaires et
callbacks transportés dans les deux représentations de records.

Les suites Int, records, constructeurs, appels directs et chunking complètent
ces frontières ; voir la [matrice](testing.md#matrice-des-tests) et les
[preuves M08](testing.md#validation-m08).
