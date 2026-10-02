# Traduction des expressions

[CodeGen](../src/Javapurs/CodeGen.purs) assemble les modules ; son dispatcher
récursif est [CodeGen.Expr.translateExpression](../src/Javapurs/CodeGen/Expr.purs).
Ce guide décrit les décisions avant `Rename`, le chunker et le rendu Java.

## Propriétaires et entrées

| Module | Responsabilité |
| --- | --- |
| `CodeGen` | Ownership, analyse TCO/types, environnement des groupes, déclarations globales et ADT, puis `DirectCalls` et `Reuse`. |
| [CodeGen.Context](../src/Javapurs/CodeGen/Context.purs) | Faits de traduction, position, exécution d'effet, capacités de saut et contrat du résultat. |
| [CodeGen.Syntax](../src/Javapurs/CodeGen/Syntax.purs) | Reconnaissance des applications, abstractions et enveloppes d'effet ; conservation des annotations utiles. |
| `CodeGen.Expr` | Dispatcher exhaustif et workers de traduction des appels, fonctions, bindings, effets, branches et boucles. |
| [Literals](../src/Javapurs/Literals.purs) | Représentation commune de Char/Number, partagée avec les workers ownership. |

Les cinq entrées `translate*` de `CodeGen` restent disponibles. L'entrée complète
est `translateWithIntFunctions :: CodegenOptions -> BackendModule -> JavaFile`.
`extractUncurriedAbs` est réexporté pour les consommateurs existants. Les analyses
spécialisées gardent leurs propriétaires : `IntLoops`, `LoopInvariants`,
`IntFunctions`, `RecordShapes`, `Ownership` et `ControlFlow`.
Leurs admissions et replis sont décrits dans le [guide des passes](specialized-passes.md).

## Contexte et résultat

`CodegenEnv` rassemble les faits du module et les noms lexicaux des caches
d'invariants. `TranslationContext` porte trois dimensions distinctes :

- `position` : `ValuePosition` ou `TailPosition` ; seule la seconde autorise
  la sélection d'un saut à la place d'un appel ;
- `effect` : `EffectValue` construit une action, `ExecutingEffect` traduit
  son exécution ; il s'agit d'un protocole syntaxique, pas d'une preuve de pureté ;
- `loops` : chaque `LoopContext` conserve cible, paramètres, référence TCO et
  `canContinue`. Une boucle peut rester visible pour ses captures tout en
  perdant la possibilité de la continuer.

| Transition | Position | Effet | Boucles parentes |
| --- | --- | --- | --- |
| `initialContext` | Valeur | Valeur d'effet | Aucune. |
| `valueContext` / `translateValue` : opérande, argument, initialiseur, garde | Valeur | Valeur d'effet | Conservées pour les lectures. |
| `closureContext` : corps d'une closure source | Terminale | Conservé par la transition | Captures conservées, tous les sauts parents interdits. |
| `Abs` ordinaire | Terminale | Valeur d'effet | `closureContext`. |
| Abstraction typée ou uncurried | Terminale | Contexte courant | `closureContext`. |
| Corps d'un `Let`/`LetRec`, `Typed`, `TypeApp` | Conservée | Conservé | Conservées. |
| Bras d'une branche | Conservée | Valeur d'effet | Conservées. |
| `EffectPure` | Conservée | Valeur d'effet | Conservées. |
| `EffectDefer` | Terminale | Conservé | Conservées. |
| Action d'un `EffectBind` | Valeur | Exécution | Conservées. |
| Continuation d'un `EffectBind` | Conservée | Exécution | Conservées. |

Le résultat nommé `Translation` contient `statements` puis `result`. Leur contrat
est **statements une fois dans l'ordre, puis résultat dans leur portée**.
`prependStatement` compose une continuation séquentielle. `asExpression` place
les statements dans un `JavaBlock` quand une expression Java est nécessaire.
`translateValue` combine cette mise en bloc avec `valueContext`.

Un argument ne remonte donc pas ses statements devant les arguments précédents.
Une garde ne remonte pas ses statements devant les gardes antérieures. Cette
discipline préserve l'ordre d'évaluation et les frontières d'exception.

## Appels et chemins de repli

Le dispatcher expose les priorités :

1. Pour `App`, essayer le worker consommateur déjà sélectionné par `Ownership`.
   L'appel doit nommer une fonction du module et fournir exactement son arité,
   ou son arité moins le dernier donneur ; ce donneur absent devient `null`.
   Les arguments Int reçoivent leur cast à leur site d'évaluation.
2. Pour les applications ordinaires, `flattenApp` conserve l'ordre des arguments
   et les types de la tête, puis `tailTarget` exige position terminale, cible
   encore active et saturation exacte. Ce chemin produit `JavaContinue`.
3. Sinon, `IntFunctions.applyFunction` choisit l'appel spécialisé ou générique.
   Le préfixe saturé des définitions récursives conserve l'ABI générique ; une
   closure retournée peut encore être primitive. Option désactivée : `JavaApply`.

`UncurriedApp` partage le chemin ordinaire/TCO, sans admission ownership.
`UncurriedEffectApp` conserve son chemin d'applications génériques. Les appels
curryfiés restent imbriqués : évaluation du callee, argument, application du
préfixe, argument suivant. Les corps des préfixes ne sont pas déplacés après
tous les arguments. La passe `DirectCalls` vient ensuite et possède ses propres
gardes d'initialisation eager/lazy et conditions d'arité.

Pour `Typed`, les fonctions spécialisées ont priorité, puis les records typés ;
le repli traduit l'enfant dans le même contexte. `TypeApp` ne sélectionne jamais
les binders primitifs d'une définition polymorphe. Le guide des
[représentations](representations.md) détaille la provenance de ces preuves,
leur projection commune et les conversions aux frontières Java/FFI.

## Exécution différée et références

`isEffectNode` reconnaît `EffectPure`, `EffectBind`, `PrimEffect`, ainsi que leurs
enveloppes de types et corps de bindings. En contexte `EffectValue`, le dispatcher
les enveloppe dans un `JavaAbs []` : le `Supplier` différé. Son corps passe en
`ExecutingEffect` et perd sa position terminale initiale. Cette enveloppe
synthétique conserve les informations de boucle ; les closures source passent
séparément par `closureContext`.

Un `EffectBind` normalise ses deux côtés avec `stripEffectDefer` et
`stripEffectAbs`. `executeEffect` force `Supplier.get()` seulement si la forme
normalisée n'est pas déjà un nœud d'effet exécuté. Cela inclut les appels étrangers
et les branches qui produisent des actions. Les statements de la continuation
restent après l'affectation du résultat de l'action précédente.

Les wrappers ne sont pas retirés indifféremment : `stripEffectDefer` ouvre les
abstractions de l'action ; `stripEffectAbs` ouvre les abstractions nullaires et
les continuations à un argument explicitement inutilisé. Les bindings et les
annotations entourant ces corps sont reconstruits. Une abstraction uncurried
vide déjà en exécution peut rendre son corps directement.

Les primitives de référence ST utilisent une cellule `Object[]` à un élément.
`EffectRefWrite` évalue et caste la référence, évalue la valeur, écrit cette valeur
puis la retourne. Deux locaux structurels conservent les évaluations uniques et
l'identité de l'objet stocké. Leurs noms internes `__ref$write` et `__value$write`
sont rendus frais par `Rename`, y compris pour des écritures successives.
Les statements d'un opérande restent dans son bloc. Ces primitives ST sont
distinctes des opérations synchronisées du port `Effect.Ref`.

## Boucles, captures et bindings récursifs

`translateLoop` prépare les invariants, ajoute la nouvelle cible et conserve
seulement les joins prouvés vers des parents encore actifs. Entrer dans une
boucle interne ne réactive jamais une cible capturée derrière une closure.

`translateLocal` sélectionne d'abord les caches d'invariants, puis les snapshots
d'itération pour les paramètres des boucles connues. Il consulte aussi les
boucles dont `canContinue` est faux : une closure échappée doit garder les valeurs
de l'itération de sa création.

`ControlFlow` détermine si la boucle doit exister, y compris pour les sauts
imbriqués qui la ciblent. Sans cache ni saut, le corps est retraduit avec les
paramètres originaux. Sinon, un `JavaWhileTrue` ou `JavaMemoizedLoop` est émis ;
`IntLoops` sélectionne les paramètres primitifs quand un saut direct existe.

Un `LetRec` singleton admis comme boucle peut devenir une affectation locale.
Si sa fonction traduite lit encore son propre binding, `mentionsJavaLocal`
impose `JavaLetRec` et sa cellule récursive : Java interdit la lecture d'un local
dans son propre initialiseur. Les groupes non admis gardent le scope récursif.

## Vérification ciblée

[test/codegen.mjs](../test/codegen.mjs) parcourt BackendSyntax → CodeGen → Rename
→ chunking optionnel → `javac --release 17` → JVM. Ses **48 contrôles par mode**
observent gardes, arguments uncurried, exceptions, effets différés et répétés,
binds, références, identité après écriture, récursion locale profonde et closures
échappées. Les suites fonctions Int, appels directs, ownership, invariants et
records complètent les chemins spécialisés ; voir la
[matrice](testing.md#matrice-des-tests) et les [preuves M06](testing.md#validation-m06).
