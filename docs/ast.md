# AST Java, parcours et portées

État documenté au **2 octobre 2026**. Le trajet complet est décrit dans le
[guide du compilateur](compiler.md) ; cette page définit les contrats de
[JavaAst](../src/Javapurs/JavaAst.purs) et des passes qui le consomment.

## Un IR mixte, des positions distinctes

`JavaExpr` représente les valeurs, statements, déclarations et sélecteurs de
méthodes. Les producteurs respectent les positions ci-dessous ; le type somme
ne rend pas une combinaison incorrecte impossible à construire.

| Famille | Nœuds | Contrat de position |
| --- | --- | --- |
| Littéraux | `JavaString`, formes fermées de `JavaRaw` | Valeurs ; les chaînes passent par l'échappement du printer. |
| Références de valeurs | `JavaLocal`, `JavaGlobalVar`, `JavaCtorSingleton`, `JavaLoopInvariant` | Lecture locale, champ de module/FFI, singleton d'ADT, ou lecture différée d'un cache Int. |
| Sélecteurs | `JavaStaticMethodRef`, `JavaInstanceMethodRef` | Exclusivement le callee de `JavaCall`. Le second porte le récepteur, sa classe de cast et le nom de méthode. |
| Appels et allocation | `JavaCall`, `JavaApply`, `JavaIntApply`, `JavaNew` | Appel Java direct, application curryfiée générique, application Int, construction d'un objet. |
| Fonctions et effets différés | `JavaAbs`, `JavaTypedAbs`, `JavaIntAbs`, `JavaFunction` | Valeurs dont le corps s'exécute à l'appel. `JavaAbs []` et `JavaFunction` produisent un `Supplier`. |
| Records | `JavaRecord`, `JavaTypedRecord`, `JavaTypedRecordGet`, `JavaTypedRecordUpdate`, `JavaMapGet`, `JavaMapUpdate` | Valeurs ; labels et formes de records sont des métadonnées. |
| Tableaux | `JavaArray`, `JavaArrayIndex` | Construction et lecture ; l'index et les éléments sont des valeurs. |
| Opérations | `JavaBinaryOp`, `JavaUnaryOp`, `JavaCast`, `JavaInstanceOf`, `JavaPropertyAccess`, `JavaTernary` | Opérandes structurels ; `JavaPropertyAccess` lit un champ, les méthodes ont leur sélecteur dédié. |
| Portées à résultat | `JavaLet`, `JavaLetRec`, `JavaBlock` | Un corps produit la valeur finale. `JavaBlock` exécute d'abord une séquence de statements. |
| Contrôle | `JavaWhileTrue`, `JavaMemoizedLoop`, `JavaContinue`, `JavaThrow` | Boucles à résultat et sorties abruptes ; le rendu dépend de la position de corps ou d'expression. |
| Déclarations locales | `JavaLocalAssign`, `JavaIntLocalAssign` | Statements non récursifs déclarant respectivement un `Object` ou un `int`. |
| Mutations et branchement statement | `JavaLocalSet`, `JavaFieldSet`, `JavaArraySet`, `JavaIf` | Écriture dans un local existant, un champ ou un tableau ; `JavaIf` contient deux séquences de statements. |
| Membres de classe | `JavaAssign`, `JavaLazyAssign`, `JavaStaticMethod`, `JavaClassDecl` | Déclarations dans `JavaFile.decls` : champ eager/lazy, worker statique ou classe d'ADT. |

Un sélecteur `…MethodRef` n'est pas une valeur de fonction ni une référence Java
`Class::method`. Pour appeler une fonction PureScript stockée dans un champ,
utiliser `JavaApply (JavaGlobalVar …) argument`. Pour appeler son worker Java,
utiliser `JavaCall (JavaStaticMethodRef …) arguments`.

Les noms de classe, de méthode, de champ et de module sont déjà préparés par
leurs producteurs. `Rename` ne les traite pas comme des variables locales.
Il visite en revanche le récepteur d'un sélecteur d'instance. Ce découpage évite
qu'un local homonyme renomme une méthode ou devienne une capture artificielle.

`JavaParamType` décrit les paramètres de workers et champs d'ADT. Un paramètre
marqué `ParamInt` dans `JavaTypedAbs` garde l'ABI publique `Object` ; seul
`JavaIntAbs` déclare un argument de closure primitif. Le type Java effectif et
les casts doivent être conservés lors d'une extraction dans un helper retournant
`Object`.

## Parcours structurels communs

`JavaAst.traverseChildren` définit une seule couche exhaustive de l'arbre :

- les enfants sont visités dans l'ordre de leurs champs ; les statements d'un
  bloc précèdent son résultat, les initialiseurs d'un groupe précèdent son corps ;
- noms, types, labels, paramètres et identités de contrôle sont conservés ;
- les corps différés et les deux branches font partie de la structure ;
- `JavaRaw` est une feuille, quel que soit son contenu textuel.

Trois opérations dérivent de cette définition :

| Opération | Usage |
| --- | --- |
| `children` | Obtenir les enfants directs pour une analyse en lecture. |
| `mapChildren` | Transformer les enfants directs avec une fonction pure. |
| `rewriteBottomUp` | Transformer les enfants, puis leur parent ; les nouveaux nœuds retournés par la règle ne sont pas revisités. |

[DirectCalls](../src/Javapurs/DirectCalls.purs) utilise `traverseChildren` avec
son état de workers utilisés. [Reuse](../src/Javapurs/Reuse.purs) utilise
`rewriteBottomUp`. [Rename](../src/Javapurs/Rename.purs) intercepte les nœuds
lexicaux avant de déléguer le reste au parcours commun. [ControlFlow](../src/Javapurs/ControlFlow.purs)
utilise `children` avec ses frontières propres.

L'ordre structurel n'est pas une trace d'exécution : une seule branche de
`JavaTernary` est prise, certains opérateurs court-circuitent, les closures sont
différées. Il ne suffit pas non plus à calculer les variables libres : les
binders doivent être interprétés par une analyse de portée.

## Renommage et portée des valeurs

`Pipeline.lowerModule` renomme chaque déclaration avant de lancer le chunker.
Le compteur de fraîcheur appartient à cet appel de `renameExpr` ; il continue
de croître entre branches et après la sortie d'un scope. Seuls les environnements
de noms sont restaurés. Les copies issues de l'inlining et les scopes frères
obtiennent ainsi des noms Java différents, même s'ils réutilisent un niveau TAST.

| Construction | Visibilité |
| --- | --- |
| `JavaAbs`, `JavaTypedAbs`, `JavaIntAbs`, `JavaStaticMethod` | Paramètres visibles dans le corps ; environnement extérieur restauré à la sortie. |
| `JavaLet name value body` | `value` voit l'environnement extérieur ; `name` est visible seulement dans `body`. |
| `JavaLocalAssign`, `JavaIntLocalAssign` | L'initialiseur voit l'ancien environnement ; le nouveau binding vaut pour les statements suivants et le résultat du bloc. |
| `JavaLetRec` | Tous les noms du groupe sont visibles dans tous les initialiseurs et dans le corps. |
| `JavaBlock` | Les statements étendent successivement le scope du bloc ; aucune déclaration n'en sort. |
| `JavaIf` | Chaque branche reçoit le même environnement extérieur ; ses bindings ne passent ni dans sa sœur ni après le `if`. |
| `JavaTernary` | Condition et branches sont des valeurs ; leurs portées explicites sont portées par `JavaLet`, `JavaBlock`, etc. |
| `JavaLocalSet` | Résout un binding existant ; ne déclare aucun nom. |
| `JavaAssign`, `JavaLazyAssign`, champs/classes/sélecteurs | Noms globaux conservés ; seuls leurs enfants valeurs sont parcourus. |

Exemple : dans un bloc sous un paramètre `x`, une déclaration locale
`x = x + 1` devient `Object x$r1 = …x$r0…;`. L'initialiseur lit le paramètre,
puis le résultat du bloc peut lire `x$r1`. Les déclarations récursives passent
par `JavaLetRec`, dont le printer construit un objet de scope avec des champs.
La visibilité mutuelle des noms n'implique pas que leurs valeurs soient déjà
initialisées : le chunker évite de transmettre ces champs par valeur depuis
leurs propres initialiseurs.

### Boucles et identités de contrôle

Une boucle lit ses arguments d'entrée et introduit stockage mutable, snapshots
finaux par itération et temporaires du prochain tour. Les noms partagés sont
définis dans [Naming](../src/Javapurs/Naming.purs) :

| Fonction | Forme générée |
| --- | --- |
| `renamedLocal` | `nom$rN` |
| `loopStorageName` | `__tco_nom` |
| `loopSnapshotName` / `snapshotBaseName` | `__final_nom` / retrait de ce préfixe |
| `loopNextName` | `__next_nom` |
| `lazyGetterName` | `__lazy_get_nom` |
| `singletonHolderName` | `__singleton$Constructeur` |

Ces helpers reçoivent des noms déjà échappés. `sanitizeName` retire les `$`
source et peut ajouter un `$` initial pour un mot-clé Java ; les suffixes
internes ne repassent pas dans cette fonction. Les noms `__final_…` de l'IR
désignent les snapshots émis par le printer ; leurs bases suivent le renommage
des paramètres de boucle.

`Rename` distingue trois environnements :

- `env` résout les lectures et écritures de valeurs ;
- `loopNames` associe une identité de boucle au nom frais de son binding ; une
  déclaration de fonction réserve cette identité avant de renommer son
  initialiseur, sans rendre la valeur elle-même récursive ;
- `loopTargets` contient les boucles effectivement englobantes. Un
  `JavaContinue` utilise cette table, même à travers une closure ou une boucle
  imbriquée. Déclarer une valeur homonyme ne change pas sa cible.

Les trois environnements sont restaurés à la sortie de leur scope. Les noms
de cibles sans binding associé restent les identités fournies par le producteur.
Celui-ci doit distinguer les identités des boucles imbriquées. Dans un
`JavaMemoizedLoop`, les noms des caches sont renommés en groupe et les lectures
`JavaLoopInvariant` suivent ces noms ; les caches sont évalués à leur premier usage.

### Captures et extraction

[Chunk](../src/Javapurs/Chunk.purs) possède l'environnement des types Java
effectifs ; [Chunk.Captures](../src/Javapurs/Chunk/Captures.purs) possède `freeOf`
et `threadStatements`. Une déclaration non récursive y suit
le même ordre initialiseur → binding que dans `Rename`. Les branches restaurent
leur environnement, les groupes récursifs ont leurs règles dédiées.

Un appel de helper conserve les captures de ses arguments. Les sélecteurs
statiques n'ont pas de captures ; un sélecteur d'instance hérite de celles de son
récepteur, mais aucun sélecteur ne peut être extrait seul comme résultat d'un
helper. Une écriture de local extérieur, un saut ou du texte opaque interdisent
les extractions qui déplaceraient cette opération. Les snapshots finaux d'une
itération peuvent devenir des paramètres ; le stockage mutable et les caches
`IntSupplier` ne prennent pas le type générique `Object` d'un helper. Le
[guide du chunker](chunking.md) détaille résumés de captures, décisions de refus,
coûts et construction des helpers.

## Java brut

[Raw](../src/Javapurs/Raw.purs) possède les deux décisions concernant `JavaRaw` :

1. `isClosedValue` admet un ensemble limité de formes émises par le backend :
   nombres décimaux avec fraction/exposant éventuels, booléens, `null`, constantes
   `Double` spéciales, caractères simples, allocation `new Object[taille]` avec
   taille numérique, et `null` suivi d'un commentaire `TODO` fermé sans texte après.
   Une expression telle que `1-e` ou un préfixe ressemblant à un getter généré
   ne prouve pas l'absence de captures. Cette décision ne prouve pas la pureté.
2. `renameIdentifiers` assure la compatibilité des fixtures avec des lectures
   locales brutes : substitution des identifiants ASCII connus, en protégeant
   chaînes, caractères, commentaires et membres après un point. Ce scanner
   ne reconstruit ni binders, ni types, ni scopes Java.

Pour les producteurs du compilateur, les lectures locales, mutations,
déclarations, appels et sauts qui participent aux passes doivent être des nœuds
structurels. Division et modulo Int dans [Operators](../src/Javapurs/Operators.purs)
utilisent ainsi des déclarations locales, casts, conditions et appels `Math`
explicites. Les deux opérandes sont évalués une fois, de gauche à droite, avant
le test du diviseur ; leurs captures sont visibles par `Rename` et `Chunk`.

Un fragment inconnu bloque l'analyse des captures ; en position statement,
tout `JavaRaw` est une barrière. Le renommage de compatibilité ne lève pas cette
barrière. Le printer peut encore construire un fragment local à son propre
template, comme la lecture des arguments de `TcoLoop` : aucun parcours d'IR
n'est exécuté après ce rendu. La FFI de classe appartient à `Ffi`/`Emit` et
n'entre pas dans ce mécanisme de substitution.

## Analyses de contrôle

[ControlFlow](../src/Javapurs/ControlFlow.purs) est indépendant du rendu :

| Question | Fonction et frontières |
| --- | --- |
| Une branche terminale contient-elle un saut imprimable directement ? | `hasDirectContinue` suit `JavaTernary` dans ses branches et `JavaBlock`/`JavaLet`/`JavaLetRec` dans leur corps. |
| Un saut apparaît-il dans le calcul courant, y compris un opérande ou statement ? | `hasAnyContinue` parcourt la structure, notamment conditions et indices ; s'arrête aux fonctions, méthodes, initialisations lazy et boucles imbriquées. |
| Une cible particulière est-elle atteinte depuis un sous-arbre ? | `hasTargetContinue` traverse aussi closures et boucles imbriquées, ainsi que les arguments d'un saut vers une autre cible. |

`CodeGen.translateLoop` utilise ces questions pour décider de la boucle et des
spécialisations autorisées. `Printer.printLoopTail` utilise la première, puis
vérifie la cible et l'arité avant d'émettre un `continue`. Un saut vers une
boucle extérieure ou à travers une frontière de méthode utilise `TcoLoop` ;
les boucles intermédiaires le relancent jusqu'à sa cible.

## Ajouter un nœud

1. Définir sa famille, ses positions valides, le type Java de son résultat,
   ses enfants et ses métadonnées dans `JavaAst` et cette page.
2. Compléter `traverseChildren`. Son analyse de cas exhaustive oblige à traiter
   chaque constructeur ; `children`, `mapChildren` et les parcours génériques
   héritent de cette définition.
3. Si le nœud lie un nom, écrit dans un local ou crée une frontière de contrôle,
   adapter les cas spécialisés de `Rename`, `Chunk.Captures` et
   `ControlFlow`. Leurs replis structurels n'inventent pas ces règles.
4. Dans `Chunk` et `Chunk.Extraction`, préciser coût, types disponibles et admission de l'extraction.
   Le repli opaque est conservateur, mais ne parcourt pas les nouvelles valeurs.
5. Ajouter le rendu dans `Printer` ou `RecordPrinter` et examiner les analyses
   spécialisées qui reconnaissent cette forme (`CodeGen`, `CountedLoops`, etc.).
6. Rejouer les lignes concernées de la [matrice](testing.md#matrice-des-tests).
   Pour les portées et le contrôle, [ast-scopes.mjs](../test/ast-scopes.mjs) relie
   renommage, chunking optionnel, `javac --release 17` et exécution JVM.
