# Comprendre le chunker

État documenté au **2 octobre 2026**. La passe transforme un `JavaFile` après
`Rename` en extrayant des sous-arbres dans des méthodes privées `__chunk$N`.
Les [contrats de l'AST](ast.md) définissent valeurs, statements et binders ;
cette page décrit comment une extraction est acceptée, construite ou refusée.

## Trois responsabilités

| Module | Responsabilité et entrées/sorties |
| --- | --- |
| [Chunk](../src/Javapurs/Chunk.purs) | Parcours, environnement des types Java disponibles et construction des helpers. `chunkFile : JavaFile -> JavaFile`. |
| [Chunk.Captures](../src/Javapurs/Chunk/Captures.purs) | Analyse lexicale et barrières. `analyzeCaptures : JavaExpr -> Captures`. |
| [Chunk.Extraction](../src/Javapurs/Chunk/Extraction.purs) | Modèle de coût et admission pure. `planExtraction : LocalTypes -> ChunkedValue -> ExtractionPlan`. |

Le trajet d'une valeur est court :

```text
chunkValue
  ├─ rebuildValue       enfants transformés, coût, captures, forme du résultat
  ├─ planExtraction     types disponibles → ExtractWith params / KeepOriginal raison
  └─ extractValue       déclaration du helper et résumé de son appel
```

`ChunkedValue` nomme les quatre informations qui circulent : `expr`, `cost`,
`captures`, `form`. Ce résumé décrit le sous-arbre **déjà reconstruit** : ses
enfants peuvent être des appels aux helpers créés plus tôt. Les arbres simples
combinent leurs résumés ; les séquences à binders utilisent `analyzeCaptures`
sur le bloc reconstruit pour tenir compte de leurs déclarations.

`chunkStatement` ne remplace jamais le statement racine par un helper à valeur.
Il traite ses opérandes, puis étend le scope s'il s'agit d'une déclaration.
`rebuildBlock` et `rebuildBranches` partagent cette logique entre les positions
de valeur, de statement et de corps de boucle.

## Lire une décision d'extraction

`planExtraction` ne crée aucun nom et ne modifie aucun arbre. Il retourne le
premier refus rencontré dans cet ordre :

| Condition | Résultat de maintien |
| --- | --- |
| La racine doit garder sa forme à cet emplacement | `RequiredAtSite form` : cast, sélecteur, fragment brut, statement ou racine opaque. |
| Son coût est inférieur ou égal à 256 | `WithinBudget`. |
| Ses dépendances comportent une barrière | `CaptureBlocked barrier`. |
| Elle demande plus de 64 paramètres | `TooManyParameters nombre`. |
| Une capture n'a pas de type local disponible | `MissingLocalType nom`. |

Sinon, `ExtractWith params` fournit les noms et types de la signature. Les noms
viennent d'un `Set` ordonné ; déclaration et appel utilisent ce même ordre.
Une racine conservée peut donc contenir des enfants déjà extraits. Le résultat
est une décision interne inspectable, pas un nouveau diagnostic CLI.

Deux positions contournent volontairement la décision à la racine d'un enfant :

- `JavaCall` reconstruit son sélecteur sans le remplacer par une valeur `Object` ;
- les opérateurs unaires/binaires reconstruisent les racines de leurs opérandes
  pour préserver leur type statique Java. Les casts restent à leur emplacement,
  même si leur opérande devient un appel de helper.

Les enfants sous ces racines peuvent toujours être découpés lorsque leurs
propres positions le permettent. Conserver le cast est notamment nécessaire
car tous les helpers retournent `Object`.

## Captures connues et barrières

`Captures = Either CaptureBarrier (Set String)` a deux sens distincts :

- `Right noms` décrit les dépendances lexicales, éventuellement aucune ;
- `Left barrière` interdit de transporter ce sous-arbre dans un helper.

`combineCaptures` propage la première barrière ou réunit les noms.
`withoutBindings` retire les noms liés par la construction, en conservant une
éventuelle barrière. **Fermé ne signifie pas pur** : un appel sans capture peut
allouer, produire des effets ou lever une exception.

| Barrière | Pourquoi elle compte |
| --- | --- |
| `OpaqueJava` | Les lectures cachées dans du Java brut inconnu ne peuvent pas devenir des paramètres fiables. En position statement, même un fragment ressemblant à un littéral reste opaque. |
| `OuterLocalWrite nom` | Écrire dans la copie d'un paramètre de helper ne mettrait plus à jour le local extérieur. |
| `LoopJump` | Un `JavaContinue` ne doit pas franchir une nouvelle frontière de méthode par cette passe. |
| `InvariantCache` | La lecture dépend d'un local `IntSupplier`, que les signatures Object/int des helpers ne représentent pas. |
| `LoopStatement` | Une boucle rencontrée en position statement reste entière. |
| `ModuleDeclaration` | Une déclaration de champ de module n'est pas une opération déplaçable dans un corps de helper. |
| `UnsupportedExpression` | Le reconstructeur n'a pas de règle de déplacement pour cette forme à cette position. |

Le parcours tient compte des paramètres, `JavaLet`, groupes `JavaLetRec`, blocs
séquentiels et branches sœurs. Une déclaration non récursive n'est ajoutée
qu'après son initialiseur. Une mutation d'un local **déclaré dans le candidat**
peut rester dans ce candidat. Les écritures à travers une référence de tableau
ou d'objet conservent, elles, l'identité référencée quand cette référence est
passée à un helper.

Les nœuds déjà opaques ne sont pas ouverts pour en extraire des morceaux :
notamment les arguments de `JavaContinue` et les boucles en position statement.
Une boucle en position valeur peut en revanche contenir des calculs découpés,
en conservant ses sauts et caches à leur emplacement.

### Types disponibles et récursion

`LocalTypes` contient les **types Java effectifs au site d'extraction** :

- paramètres de `JavaAbs` et `JavaTypedAbs` : `ParamObject`, même avec une
  annotation Int sur la fonction curryfiée ;
- paramètre de `JavaIntAbs`, locaux `JavaIntLocalAssign` et paramètres Int de
  workers : `ParamInt` ;
- autres locaux : `ParamObject` ;
- dans une boucle, snapshots finaux `__final_…` suivant le type du paramètre ;
  stockage mutable et caches `IntSupplier` exclus.

`withLocalTypes` restaure la table à la sortie du scope et entre branches,
tout en gardant les compteurs et helpers émis. `Rename` doit avoir donné des
noms distincts aux binders avant cette analyse.

Un nom peut être connu lexicalement sans être disponible comme paramètre.
Les initialiseurs d'un `JavaLetRec` ferment sur des champs de l'objet de scope
récursif du printer. Passer un de ces champs à un helper pendant la création
de la closure figerait sa valeur encore nulle. Leurs noms restent dans les
captures analysées, mais leurs types sont absents de `LocalTypes` dans les
initialiseurs : `MissingLocalType` refuse l'extraction concernée. Le corps,
après initialisation du groupe, reçoit ces noms comme locaux `Object`.

## Budget : trois limites différentes

Les fonctions de coût et les constantes appartiennent à `Chunk.Extraction`.

| Règle | Formule et rôle |
| --- | --- |
| Budget de valeur | `maxChunkCost = 256` ; extraction seulement si le coût est **strictement supérieur**. |
| Coût ordinaire | `nodeCost = 1 + somme(coûts des enfants reconstruits)`. |
| Texte | `textCost = 1 + longueur / 16`, division entière. |
| Scope imbriqué | `scopeCost coût = 4 * min (257, coût)`. Appliqué aux lets, groupes récursifs et blocs ordinaires. |
| Signature du helper | `maxChunkParams = 64`, indépendamment du coût. Object/int utilisent chacun un slot parmi les 255 autorisés par la JVM pour une méthode statique. |
| Appel de remplacement | `1 + nombre de paramètres`, avec les captures de **tous** ses arguments. |
| Remplissage d'un grand tableau | `filledArrayCost taille = 1 + taille * 8`, estimation de l'allocation et des copies indexées produites. |

Le budget guide la taille des sous-arbres traités par `javac` et limite les
risques de dépasser les 65 535 octets de bytecode d'une méthode. Il ne mesure
pas ces octets. Un candidat refusé peut rester au-dessus du budget ; le coût
des FFI et des templates Java n'est pas modélisé exhaustivement.

### Pourquoi pondérer les scopes : BigFunction

Des blocs peu volumineux mais profondément imbriqués deviennent des classes
anonymes `Supplier` dans le Java imprimé. Lors de l'attribution de ces arbres,
`javac` copie les scopes englobants à répétition. Un simple comptage additif
laissait BigFunction demander beaucoup de mémoire avant même la limite de
taille d'une méthode.

Le facteur 4 pousse donc les blocs imbriqués vers l'extraction plus tôt que
les opérations plates. Le `min (257, coût)` borne la contribution pondérée et
évite une croissance exponentielle du compteur ; il ne borne pas physiquement
la taille d'un arbre opaque. Le bloc directement contenu dans le corps d'une
boucle utilise le coût ordinaire : il est déjà rendu dans la méthode de boucle.

Les budgets sont des heuristiques validées par les fixtures, pas une promesse
universelle de heap ou de temps. Le temps historique de BigFunction dans le
[registre](testing.md#références-acquises-avant-m01) reste une mesure séparée du
rejeu fonctionnel de M05.

## Construire les helpers et les groupes de tableaux

`emitHelper` alloue le prochain nom `__chunk$N`, enregistre un `JavaStaticMethod`
et retourne son `JavaCall`. Les helpers des enfants sont émis avant ceux de
leurs parents, puis placés avant les déclarations originales dans `JavaFile`.
`extractValue` conserve dans le résumé de l'appel les captures de chaque
argument. Sans cela, une extraction englobante pourrait perdre les dépendances
de helpers déjà créés.

Un grand `JavaArray` dont tous les éléments sont fermés suit un chemin dédié :

1. `largeClosedArray` vérifie le budget et l'absence de captures/barrières.
2. `groupItems` forme des groupes adjacents de largeur
   `max 1 (256 / coût maximal d'un élément)`. Un élément surdimensionné forme
   un groupe d'un élément ; son coût ne devient pas artificiellement petit.
3. `emitArrayGroups` utilise le même `emitHelper`, avec une signature sans
   paramètre ; chaque groupe retourne son petit tableau.
4. `chunkClosedArray` alloue le tableau final une fois. `fillGroup` mémorise
   **un seul appel par groupe** dans un local, puis copie ses éléments en ordre.

Recalculer l'appel de groupe pour chaque élément répéterait tous ses effets et
allocations. La fixture `Effects` contrôle les 300 appels, leur ordre et les
300 identités d'objets distinctes. `ShortCircuit` vérifie qu'une branche ignorée
n'exécute rien et qu'une exception garde son identité.

## Vérifier une modification

Depuis le dépôt du compilateur :

```bash
./bin/build
node test/chunk.mjs
node test/big-function.mjs
./bin/test DerivingTraversable
```

`chunk.mjs` contient **15 fixtures** : blocs fermés, captures imbriquées et
appels de helpers, branches sœurs, types effectifs, Java brut, récursion,
mutation, tableaux à effets, court-circuit, scopes profonds, boucles, puis les
quatre frontières 256/257 unités et 64/65 captures. Les quatre nouvelles
frontières ont été exécutées sur l'implémentation de départ avant le refactoring.

Pour une règle de portée ou de contrôle partagée, ajouter
`node test/ast-scopes.mjs` : 110 contrôles JVM avec et sans chunking. BigFunction
prépare son workspace isolé et exécute 155 contrôles de branches. Les conditions
de comparaison des sources Java et les preuves du lot sont dans la
[validation M05](testing.md#validation-m05).
