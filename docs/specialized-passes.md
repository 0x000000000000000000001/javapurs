# Passes spécialisées : admission, transformation et repli

Une passe accepte une forme avec des preuves locales précises. Son refus conserve
le chemin ordinaire. Les étapes ne manipulent pas toutes le même IR : les preuves
sur les usages PureScript précèdent la traduction, tandis que les transformations
sur le Java structurel précèdent renommage, chunking et rendu.

## Ordre et points d'entrée

| Moment | Passe / interface | Résultat |
| --- | --- | --- |
| Avant TCO et annotations Java | [Ownership.prepare](../src/Javapurs/Ownership.purs) | Module réécrit, signatures et déclarations des workers, classes mutables, diagnostics. |
| Traduction d'une boucle | [LoopInvariants.prepareLoop](../src/Javapurs/LoopInvariants.purs) avec [PureInvariants](../src/Javapurs/PureInvariants.purs) | `LoopPlan` : corps réécrit et caches à installer dans cette invocation. |
| Traduction d'une boucle avec saut direct | [IntLoops.intLoopParams](../src/Javapurs/IntLoops.purs) | Sous-ensemble des paramètres dont le stockage de boucle peut être `int`. |
| Après assemblage du `JavaFile` | [DirectCalls.directCalls](../src/Javapurs/DirectCalls.purs) | Appels saturés réécrits et workers statiques utilisés. |
| Après `DirectCalls` | [Reuse.reuseConstructors](../src/Javapurs/Reuse.purs) | Reconstruction identique remplacée par le scrutinee, éventuellement sous une garde. |
| Après renommage et chunking, dans le renderer de boucle | [CountedLoops.countedLoop](../src/Javapurs/CountedLoops.purs) | Plan optionnel d'un compte à rebours primitif ; `Printer.Body` vérifie sa cible avant de le rendre. |

L'ordre est fixé par [CodeGen](../src/Javapurs/CodeGen.purs),
[CodeGen.Expr](../src/Javapurs/CodeGen/Expr.purs), [Pipeline](../src/Javapurs/Pipeline.purs)
et [Printer.Body](../src/Javapurs/Printer/Body.purs). Les options ownership,
invariants et appels directs sont indépendantes ; les analyses Int, la
réutilisation structurelle et le rendu compté ont leurs propres admissions.

## Appels directs

`DirectCalls` suit trois étapes : sélectionner les candidats, réécrire les appels
admis par `admitCall`, puis émettre les wrappers et workers effectivement utilisés.
`CallPlan` nomme candidat, arguments et éventuel champ à contrôler.

### Candidats et arité

- Binding eager : au moins deux paramètres ; binding lazy : au moins un.
- Préfixe de lambdas contiguës non vides `JavaAbs`/`JavaTypedAbs`, au plus
  **32 paramètres**, avec noms distincts. Une opération, un bloc ou `JavaIntAbs`
  arrête ce préfixe ; le corps restant peut retourner une closure.
- Nom de binding unique et nom `__direct$index` disponible. L'indice de déclaration
  stabilise le nom, y compris quand d'autres candidats sont refusés.
- Appel au global du module courant, exactement saturé. Le parcours bottom-up
  permet de transformer le préfixe saturé d'une surapplication ; les arguments
  suivants restent évalués après l'exécution de ce préfixe.

### Initialisation

| Site | Décision |
| --- | --- |
| Callee déclaré avant le caller, tous deux eager | Appel direct ; les arguments ne sont pas dupliqués dans un repli inutile. |
| Callee antérieur lazy, ou caller lazy | Garde `calleeField == null` : conserver l'application curryfiée dans ce cas, appeler le worker sinon. |
| Getter lazy du binding récursif courant, exactement saturé | Appel direct à son propre worker : le getter a terminé avant l'exécution du corps. |
| Déclaration antérieure au callee, autre getter, appel local/étranger, arité insuffisante | Application ordinaire. |

Le caller lazy peut être exécuté par une initialisation réentrante **avant**
l'affectation d'un champ eager pourtant situé plus haut dans le fichier. La garde
préserve aussi le moment où un appel nul arrête l'évaluation de ses arguments.
Entre bindings eager, supprimer la garde évite la duplication exponentielle des
sous-arbres d'appels imbriqués.

L'émission reprend le **corps déjà réécrit**, puis conserve les groupes de lambdas
publiques `Object`. Les signatures de worker et leurs casts sont décrits dans
[les conventions d'appel](representations.md). Aucun worker n'est émis sans appel
réécrit ; son corps reste accessible par le champ public générique.

Régressions : [direct-calls.mjs](../test/direct-calls.mjs) couvre arités,
partielles/surapplications, collisions, scopes, frontières de calcul retournant
une closure, initialisations eager/lazy et exceptions, dans les deux modes.

## Paramètres Int et boucles comptées

`IntLoops` reconnaît un local directement annoté Int ou directement utilisé par
une primitive arithmétique, binaire ou comparative Int. Il peut traverser des
`Typed` pour retrouver ce local ; un `TypeApp` et un résultat d'application ne
prouvent pas le type du binder. L'analyse filtre les seuls paramètres de la
boucle fournis par le caller. Les snapshots d'itération conservent cette
représentation et les closures capturent ces snapshots, pas le stockage mutable
de l'itération suivante.

`CountedLoops` reste une petite reconnaissance pure :

1. Corps exactement `counter == 0 ? result : continue(values)` ; zéro peut être
   à gauche, le compteur à n'importe quelle position dans les paramètres.
2. Tous les paramètres et toutes les valeurs de continuation ont une preuve Int.
   Le résultat et les mises à jour n'utilisent que snapshots, littéraux Int
   canoniques, casts Int et une liste fermée d'opérateurs sans appel.
3. Le compteur est remplacé par son snapshot moins **un**.
4. `Printer.Body.countedPlan` exige que le `continue` vise la boucle courante.

Le renderer utilise `for (index = 0; index < limit; index++)` uniquement pour un
compteur initial non négatif. Le `while` original reste le repli des valeurs
négatives, qui atteignent zéro après wraparound Int. Toutes les nouvelles valeurs
sont calculées avant les affectations ; un échange de paramètres conserve ainsi
les anciennes valeurs. Le résultat lit les snapshots de l'état final.

Régressions : [int-loops.mjs](../test/int-loops.mjs),
[counted-loops.mjs](../test/counted-loops.mjs), [tco.mjs](../test/tco.mjs) et
[ast-scopes.mjs](../test/ast-scopes.mjs). Les refus incluent paramètres inconnus,
appels, closures, effets, divisions, conditions différentes et pas autre que -1 ;
les contrôles JVM couvrent overflow, borne maximale, échanges et repli négatif.

## Invariants : preuve et durée de vie du cache

`PureInvariants.isPureIntInvariant` exige simultanément absence de variables
libres, résultat Int et pureté profonde admise avec un budget de **2048 visites**.
La consommation des flèches partage `TypeEvidence.applyArguments` ; l'analyse de
pureté conserve ses propres règles de parcours et de résolution des définitions.

- Seules les définitions du module courant sont résolues, plus la constante
  exacte `Data.Unit.unit` annotée Unit. Une annotation Unit n'autorise pas une
  autre globale.
- Les arguments d'appels et les corps des closures sont vérifiés, même quand
  une branche semble inaccessible ou qu'une closure paraît inutilisée.
- Une hypothèse récursive de fonction est permise ; elle ne justifie pas un
  cycle passant par une valeur globale évaluée eager. Les bindings locaux
  récursifs doivent tous être des fonctions.
- FFI/inconnus, effets, échecs explicites, agrégats mutables et leurs lectures,
  constructions et mises à jour restent hors de cette preuve.

La preuve porte sur la répétabilité, **pas sur la terminaison**. `LoopInvariants`
remplace uniquement les appels non terminaux admis. Il ne descend pas dans une
closure, un effet ni les définitions d'un groupe récursif imbriqué. Chaque
occurrence garde son propre cache, identifié par le scope de boucle et son indice.

`CodeGen.Expr` et `Printer.Body` installent les caches dans l'invocation de la
boucle : le calcul reste à sa première utilisation réelle. Seul un résultat Int
réussi marque le cache prêt. Une branche non exécutée ou une boucle vide ne force
rien ; une exception ne valide jamais le cache. Deux invocations ne partagent rien.

Régressions : [loop-invariants.mjs](../test/loop-invariants.mjs), pour les preuves
et refus, barrières de scopes, forçage différé, échecs et caches par invocation.

## Réutilisation structurelle de constructeurs

`Reuse` travaille sur des classes connues du `JavaFile`, en parcours bottom-up.
Il reconnaît soit toutes les projections du **même local**, aux mêmes indices,
soit un seul remplacement par un singleton nullaire et toutes les autres
projections identiques. Le premier cas retourne le local ; le second compare le
champ par identité et choisit entre ce local et la construction originale.

Un champ primitif ne reçoit pas une garde d'égalité de référence. Plusieurs
scrutinees, indices permutés, inconnus et arguments non reconnus conservent
l'allocation. Cette passe ne mute aucune cellule ; les preuves de consommation
appartiennent à Ownership. [constructor-reuse.mjs](../test/constructor-reuse.mjs)
relie chacune de ces admissions/refus aux assertions AST et aux identités JVM.

## Ownership : cinq responsabilités et une orchestration

| Module | Responsabilité / frontière |
| --- | --- |
| [Ownership](../src/Javapurs/Ownership.purs) | Orchestration, validation à point fixe, réécriture des appels frais et fermeture transitive des workers utilisés. |
| [Candidates](../src/Javapurs/Ownership/Candidates.purs) | Reconnaissance des types d'arbre, signatures, candidats globaux/locaux, captures et réservation des noms. |
| [Model](../src/Javapurs/Ownership/Model.purs) | Identités, chemins, types scalaires, `TreeTerm`, `Term`, environnements et pools de cellules. |
| [Analysis](../src/Javapurs/Ownership/Analysis.purs) | Lectures de champs, appels connus, scalaires, termes de résultat, alias et fraîcheur au site d'appel. |
| [Cells](../src/Javapurs/Ownership/Cells.purs) | Snapshots, chemins retirés, cellules mortes et donneurs utilisables. |
| [Workers](../src/Javapurs/Ownership/Workers.purs) | Séquences d'arguments/écritures, scopes, sauts terminaux et déclarations Java. |

### Sélection, validation et appels

Le type d'arbre doit avoir exactement un constructeur non nullaire, au plus une
feuille nullaire et au moins un champ récursif. Les autres champs doivent avoir
une représentation scalaire admise. Le nom qualifié du type permet d'accepter
les instantiations d'une déclaration polymorphe.

Un candidat retourne cet arbre, reçoit au moins un argument arbre et possède
autant de binders que sa signature de fonction. Les captures d'un groupe local
sont les références dont le niveau absolu est inférieur au groupe ; elles entrent
comme scalaires empruntés, jamais comme arbres possédés.

La génération complète du worker constitue la validation de ses usages. Si un
callee est rejeté, ses callers sont revérifiés jusqu'au point fixe. Les déclarations
de ce dernier graphe sont conservées avec les candidats validés, puis seules les
déclarations transitivement atteignables sont émises. Cette conservation évite
une nouvelle génération à l'émission et relie directement preuve et livrable.

La réécriture extérieure exige une application exactement saturée et des arbres
frais construits récursivement ; un local emprunté, une globale ou un appel opaque
ne suffisent pas. Un candidat admis mais jamais appelé avec ces preuves ne rend
pas sa classe mutable. Le chemin persistant public reste disponible.

### Chemins, captures et cellules

`Path root indices` désigne un emplacement dans un argument possédé. Deux chemins
égaux, ou dont l'un est préfixe de l'autre, se recouvrent. Les feuilles conservées
d'un résultat doivent être disjointes. Avant un calcul consommateur dans un `let`,
les chemins nécessaires à la continuation — y compris les lectures scalaires —
doivent aussi rester disjoints des chemins consommés.

`Cells.plan` snapshotte les arbres conservés et tous les scalaires **avant** les
écritures, puis sélectionne les cellules que ni résultat conservé ni continuation
ne peuvent observer. Les slots `known` sont pris une seule fois ; les slots
`nullable` sont testés et vidés lorsqu'ils fournissent un nœud. Un singleton
feuille n'est jamais une cellule réutilisable. Sans cellule, le worker alloue.

Les appels imbriqués reçoivent leurs arguments dans l'ordre et un donneur seulement
au site autorisé. Les captures restent empruntées. Après consommation, les chemins
retirés quittent l'environnement ; une lecture future impossible rejette le worker
entier plutôt que d'émettre un accès à un ancien champ déjà muté.

Les workers avec auto-appel terminal utilisent les snapshots d'itération et leur
propre cible de boucle. Le choix de cette cible doit précéder la validation des
arguments locaux : un alias introduit par `let` ne supprime pas l'auto-appel.

Les grands arbres de branches peuvent être divisés en méthodes `$case…` au-delà
de **6000 caractères imprimés**. C'est une heuristique : une forme sans branche
ou un worker de boucle n'est pas découpé par ce helper, et aucune taille de bytecode
ni décision d'inlining HotSpot n'en est déduite. Le chunker Java intervient ensuite.

### Régressions d'ownership

- [ownership.mjs](../test/ownership.mjs) : arbres, listes polymorphes, groupe local
  avec capture scalaire, worker récursif et appel avec argument emprunté.
- [ownership-admission.mjs](../test/ownership-admission.mjs) : alias égal/préfixe,
  continuation encore vivante, cascade de refus, layout ambigu, noms réservés,
  échanges via snapshots et représentation des littéraux, ownership on/off.
- [ownership-loops.mjs](../test/ownership-loops.mjs) : auto-appels sous alias arbre,
  alias scalaire et scope récursif ; profondeur 100 000 avec petite pile, dans les
  deux modes.

Les littéraux `Char`/`Number` passent par [Literals](../src/Javapurs/Literals.purs),
partagé avec la traduction ordinaire : String échappée pour Char, constantes Java
pour NaN/infinis et conservation du signe de zéro. Ces conventions valent aussi
dans un worker consommateur.

Les commandes et comparaisons du lot figurent dans les
[preuves M09](testing.md#validation-m09) et la [matrice](testing.md#matrice-des-tests).
