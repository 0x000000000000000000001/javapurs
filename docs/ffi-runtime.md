# Contrats FFI et runtimes Java

État documenté au **5 octobre 2026**. Ce guide relie les conventions d'appel aux
propriétaires des états et des callbacks. Le [guide des représentations](representations.md)
décrit les preuves de type et le stockage ; la [matrice de tests](testing.md#matrice-des-tests)
donne les commandes de validation.

## Résolution et insertion

| Étape | Propriétaire | Contrat |
| --- | --- | --- |
| Découverte | [PBO FfiSupport](../../../purescript-backend-optimizer-javapurs/src/PureScript/Backend/Optimizer/FfiSupport.js) | D'abord le `.java` adjacent au chemin `.purs` du module TAST ; ensuite les racines découvertes sous `.spago`, `spago.d` et le dossier appelant. |
| Lecture | [Ffi.loadForeign](../src/Javapurs/Ffi.purs) | Retourne `Maybe ForeignSource = { path, source }` ; une absence et une erreur de lecture sont distinctes. |
| Relevé | `Ffi.describeForeign`, [FFI Node](../src/Javapurs/Ffi.js) | Décrit cette sélection effective, le chemin du module TAST et les bindings ; aucun second choix de fragment. |
| Membres étrangers | `Ffi.renderForeign` | Insère le fragment non vide tel quel ; sinon émet des champs/méthodes de stub pour les imports étrangers. `FFI_STUB` est toujours présent. |
| Classe et fichiers | [Emit](../src/Javapurs/Emit.purs), [Output](../src/Javapurs/Output.purs) | `Emit` assemble membres FFI et déclarations imprimées ; `Output` possède staging, inventaire et publication. |
| Signatures et dépendances | `javac`, puis la JVM | Vérifient types/références et exécutent les conventions fournies par les ports. |

Dans chaque racine de repli, PBO essaie `src/A/B.java`, `src/A.B.java`, puis
`A.B.java` pour `A.B`. Sa liste de racines est mise en cache dans le processus.
Le pilote Java transmet `".java"`, aucune racine supplémentaire et aucun dossier
FFI CLI. La sélection des ports locaux appartient à `workspace.extraPackages`
dans Spago : elle doit couvrir les dépendances transitives exécutées, notamment
`foreign` pour la conversion des rejets Promise/Aff.

Un fragment contient des **membres** de `__M$A_B`, sans classe enveloppante,
`package` ou `import`. Les helpers sont des méthodes/classes internes ; les
types Java sont qualifiés. Les noms exportés suivent
[Naming.sanitizeName](../src/Javapurs/Naming.purs), par exemple `$new` et `$catch`
dans `Promise.Internal`. Un fichier composé seulement d'espaces reste non vide :
aucun binding manquant n'est ajouté automatiquement à un fragment fourni.
Chaque binding stub possède un objet `__MissingFFI` compatible avec `Function`
et `Supplier`. Son `apply` ou `get`, ainsi que la méthode varargs de compatibilité,
lève `UnsupportedOperationException("Missing Java FFI: Module.binding")` avec
le nom PureScript original, même si le nom Java est échappé (`void` → `$void`).
L'appel curryfié échoue dès la première application ; l'effet sans argument échoue
au forçage. Le champ historique `FFI_STUB` reste présent comme sentinel de module.
Un Java compilable peut encore manquer une implémentation FFI sur un chemin
particulier : pour une valeur scalaire absente, un cast/unboxing peut aussi révéler
une représentation manquante avant tout appel du stub.

Cette frontière, déjà isolée en M03, conserve son organisation. Les protocoles
ci-dessous appartiennent aux ports et n'ajoutent aucune règle au résolveur.

### Relevé de la génération

Chaque génération réussie publie un champ **`ffi`** dans
`<java-output>/.javapurs-manifest.json`, avec `version: 1` et `modules`, triés par
nom. Ce relevé suit exactement la même publication/restauration que les sources
Java. Une génération échouée laisse le relevé de la dernière génération réussie ;
les diagnostics de l'essai courant restent dans stderr. Un message final indique
le chemin du manifeste. Les anciens manifestes M13 sans champ `ffi` sont acceptés
et complétés au prochain succès ; `files` reste l'inventaire de propriété Java.

| Champ d'une entrée `ffi.modules` | Sens |
| --- | --- |
| `moduleName` | Nom PureScript, y compris les modules sans déclaration foreign. |
| `moduleSource` | Source `.purs` indiquée par le TAST, sous forme `{ path, realPath, origin }`. `path` est absolu ; `realPath` résout les symlinks s'il existe, sinon vaut `null`. |
| `adjacentJava` | Chemin absolu du candidat `.java` adjacent, utile quand la dépendance sélectionnée n'en contient pas. |
| `selectedJava` | Même forme de localisation pour le fragment effectivement retenu, ou `null`. |
| `fragmentSha256` | SHA-256 UTF-8 du texte lu et utilisé pour l'insertion, y compris le texte vide ; `null` si absent. |
| `resolution` | `adjacent`, `search` (repli PBO), ou `not-found`. |
| `status` | `provided` pour un texte non vide, `empty` pour zéro caractère, `missing` pour une absence avec bindings, `not-required` pour une absence sans binding. |
| `bindings` | Noms foreign déclarés ou conservés par PBO : `{ name, javaName, retained }`, triés. `retained` signale la présence dans l'inventaire foreign optimisé, pas la présence d'un membre dans un fragment fourni ni son exécution. |
| `verification` | Toujours `not-checked` : le backend ne prouve pas la couverture du fragment. Les preuves `javac`/JVM appartiennent aux fixtures nommées ci-dessous. |

`origin` qualifie **l'emplacement du chemin** : `workspace` sous le dossier
appelant, `spago` sous ses `.spago`/`spago.d`, `external` ailleurs. Ce n'est pas
une déduction du nom/version de package. Les chemins visible et réel permettent
de distinguer cache du registre, source applicative et checkout local, même en
présence de symlinks. Un module purement PureScript comme `Promise.Aff` est
`not-required` tout en dépendant transitivement de modules à FFI.

Pour chaque module avec bindings ou fragment, stderr donne état, source/origine,
Java retenu ou candidat adjacent, mode de résolution et noms foreign. Exemple de
lecture ciblée du relevé, depuis l'application :

```bash
node -e 'const {ffi} = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.log(JSON.stringify(ffi.modules.filter(m => m.status === "missing" || m.status === "empty"), null, 2))' java_output/.javapurs-manifest.json
```

Pour corriger une sélection, partir de `moduleSource.path` : si `Foreign` vient
de `.spago/p/foreign-…/src/Foreign.purs` sans Java adjacent, sélectionner le port
`javapurs-foreign` dans `workspace.extraPackages`, reconstruire les TAST puis le
Java et vérifier le nouveau `selectedJava.realPath`. `ffi-ports.mjs` réalise ces
deux sélections avec Spago réel. Un fragment `provided` conserve ce statut même
si un de ses bindings est omis ; `ffi-diagnostics.mjs` démontre l'échec `javac`
lorsqu'un consommateur référence ce membre, y compris pour un fichier d'espaces.

### Couverture exécutée et dépendances des quatre ports

La table relie les chemins exercés à des fixtures, sans assimiler l'inventaire des
bindings à une couverture complète. Les contrôles directs M10 compilent les vrais
fragments avec un shim Either ; l'intégration M14 utilise les ADT et API PureScript
réels. Les [suites attendues M12](testing.md#suites-asynchrones-des-ports) apportent
des preuves supplémentaires, datées séparément.

| Port | Chemins exécutés / preuve nommée | Dépendances pour ces chemins |
| --- | --- | --- |
| Refs | Groupe `refs` de [FfiRuntimeChecks.java](../test/support/FfiRuntimeChecks.java) : allocation différée/identité, `read`, `write`, `modifyImpl` concurrent et exceptionnel, `newWithSelf` (4 contrôles). [FfiPorts](../tests/ffi-ports/Main.purs) : `Ref.modify result/state`, références utilisées par les rendez-vous. | `effect`, `prelude`. Le fragment Java n'appelle que le JDK ; les enveloppes/dictionnaires viennent des modules compilés. |
| Aff | Groupe `aff` du même harness (18 contrôles) : bind/map, fibres, joins, callbacks/désabonnement, annulation, exceptions, bracket, parallèle et supervision. FfiPorts : `repeated join`, `bracket cleanup`, `cancellation cause`, `supervised cleanup`, `Unit race`. | API Effect, Exceptions, fonctions non curryfiées et ADT Either ; transitivement ST/Partial/Unsafe.Coerce et les bibliothèques de classes/transformers. Le [spago.yaml Aff](../../javapurs-aff/spago.yaml) donne les dépendances ; le template de test sélectionne leurs ports Java nécessaires. |
| Promise | Groupe `promise` (14 contrôles) : pending/adoption, premier règlement, callbacks, erreurs, `all`, `race`, `finally`, auto-résolution et chaîne profonde. FfiPorts : `Promise.all order`, `Promise.race rejection`, `Promise.finally pending cleanup`, `Promise handler exception`, `Promise.Lazy`. | `effect` et ses wrappers `EffectFn`, `functions` (`Fn3`), `exceptions`, Maybe ; les wrappers Lazy emploient aussi Newtype/Traversable. Fragments `Promise.Internal` et `Promise.Rejection`, pas uniquement le premier. |
| Promise/Aff | FfiPorts : `pending Aff-Promise roundtrip`, `Aff-Promise rejection`, `string rejection coercion`, `toAffE`, `custom rejection coercion` ; réussite et attente dans les deux modes records. Le pont lui-même n'a pas de fragment Java. | `aff`, `js-promise`, `effect`, `exceptions` et **`foreign`** via `readString`/`unsafeToForeign`, ainsi que Either/Maybe/Except. Les conversions appellent `Promise.Rejection` puis `Foreign.tagOf` pour une chaîne ; un aller-retour réussi seul ne teste pas ce chemin de rejet. |

Le workspace de cette intégration est défini par le
[template du runner](../tests/runner/spago.yaml), complété dans
[ffi-ports.mjs](../test/ffi-ports.mjs) par `aff`, `js-promise`, `js-promise-aff` et
`foreign`. Le template sélectionne déjà `refs`, `effect`, `prelude`, `exceptions`,
`functions`, `st`, `partial`, `unsafe-coerce` et les ports de collections/records
utilisés par les fixtures ; Assert et Console fournissent leurs contrôles/logs.
Les bibliothèques de classes et ADT restantes viennent du package set **77.10.1**.
Les quatre `bin/test-runtime` pointent vers ces fixtures ; ce layout et ces chemins
sont la référence de sélection, plutôt que la longue liste d'extraPackages des
workspaces historiques de chaque port.

## Conventions d'appel et données

| Valeur PureScript | Frontière Java |
| --- | --- |
| `a -> b -> c` | Deux `Function<Object, Object>` imbriquées ; appliquer la première conserve une fonction pour le deuxième argument. |
| `Effect a` | `Supplier<Object>` ; construction de l'action et forçage par `get()` sont distincts. Chaque forçage réexécute l'action. |
| `FnN`, `EffectFnN` des ports concernés | Wrappers curryfiés Java ; les adaptateurs PureScript/du backend fournissent les arguments, puis forcent le `Supplier` pour un effet. Une lambda Java multi-argument n'est pas cette ABI. |
| `Aff a` | `Effect.Aff.AffRun` ; son contexte est fourni par l'interpréteur Aff. |
| `Promise a` | `Promise.Internal.PromiseValue`, avec règlement éventuellement futur. `Effect (Promise a)` ajoute une enveloppe `Supplier`. |
| `Ref a` | Cellule `Object[]` d'un élément, partagée par identité. |
| Record | `Map<String, Object>` ; les records typés générés implémentent aussi cette interface et sont immuables. Copier avant une mise à jour. |
| Tableau, ADT, scalaire | `Object[]`, classes imbriquées de constructeurs, puis valeurs boxed à l'ABI générique. `Char` est une `String`, pas un `Character`. |

Les callbacks suivent eux aussi ces enveloppes : `a -> Effect Unit` est une
`Function` qui **retourne** un `Supplier`. Appliquer la fonction sans forcer son
effet ne livre pas le résultat. `null` peut représenter Unit et reste un résultat
valide ; les états pending/réussi/échoué utilisent des indicateurs distincts.
Les champs d'ADT et certains workers peuvent être primitifs ; leur adaptation
appartient au [contrat des représentations](representations.md#stockage-et-conversions-scalaires).

Le port [Effect.Exception](../../javapurs-exceptions/src/Effect/Exception.java)
fournit son `Error` Java. Une exception levée par une FFI Effect se propage lors
du forçage. Aff normalise les `Throwable` en `AffError` ; Promise rejette le
résultat du callback/exécuteur avec l'objet levé. Les rejets Promise sont des
`Object` arbitraires : [Promise.Rejection](../../javapurs-js-promise/src/Promise/Rejection.java)
reconnaît un `Throwable` comme Error et conserve son identité.

Les quatre ports présentés ici utilisent le JDK, sans JAR tiers. Une FFI
applicative peut en demander : son appelant fournit les dépendances aux deux
classpaths, `javac` et `java`. Voir la [recette d'application](../README.md#compile-and-run-an-application).
Le résolveur de fragments ne gère ni JAR ni packaging.

## Références

[Effect/Ref.java](../../javapurs-refs/src/Effect/Ref.java) possède la cellule et
ses opérations. `_new` alloue une cellule différente à chaque forçage ;
`newWithSelf` transmet au callback la cellule qui sera retournée.

- `read` et `write` synchronisent sur **la cellule**, assurant la visibilité des
  écritures entre fibres. Le contenu référencé peut avoir sa propre mutabilité.
- `modifyImpl` garde ce même moniteur pendant lecture → callback → écriture.
  Le callback s'exécute une fois et retourne `{ state, value }`. S'il lève une
  exception, l'ancienne valeur de la cellule reste en place.
- Le résultat du callback est lu par labels via Map. Le repli réflexif
  `read0/read1` reste disponible pour les anciens layouts ; les records typés
  courants empruntent le chemin Map.

Le verrou est réentrant, mais un callback qui attend une autre opération sur
la même cellule peut la bloquer. Cette atomicité est propre à Ref ; les runtimes
Aff et Promise invoquent leurs callbacks hors de leurs moniteurs.

## Aff

Le fragment [Effect/Aff.java](../../javapurs-aff/src/Effect/Aff.java) est organisé
dans l'ordre exécution → annulation → fibres → asynchronisme/bracket → parallèle
→ wrappers FFI. Le [module PureScript](../../javapurs-aff/src/Effect/Aff.purs)
possède `Fiber`, `Canceler`, `joinFiber`, `killFiber` et `supervise`.

| Propriétaire Java | Responsabilité et durée de vie |
| --- | --- |
| `runAffSync`, `BindNode` | Interprétation avec pile explicite des binds/maps ; checkpoints avant/après action. L'action peut être exécutée à nouveau dans un autre contexte. |
| `RunContext`, `Cancellation` | Première cause d'annulation, snapshot des inscriptions et fin des cancelers. La réservation ne lance aucun code utilisateur. Le snapshot est libéré après invocation. |
| `Registration` | Inscription active au plus une fois ; retrait à la fin de l'action. Une inscription après annulation est invoquée immédiatement avec la cause retenue. |
| `NativeFiber`, `FiberResult` | Exécution unique, résultat mémorisé et état de complétion. Un résultat Unit nul se distingue d'une absence de résultat. |
| `Observer` | Livraison unique, ou retrait avant que la livraison soit revendiquée. Une livraison déjà revendiquée peut encore terminer après le retrait. |
| `Supervisor` | Ensemble de toutes les fibres du sous-arbre ; retrait des fibres terminées, fermeture commune à l'inscription des enfants. |
| `ParallelPair` | Résultats des deux branches, décision et attente des nettoyages ; contexte parent relié par une inscription retirable. |
| `fiberRecord` et champs FFI finaux | ABI curryfiée/Effect autour des opérations précédentes. |

### Fibres et callbacks

Une fibre est suspendue, démarrée, en complétion, puis terminée. `isSuspended`
signifie strictement « pas encore démarrée ». `run` et `join` démarrent au plus
une fois ; `onComplete` observe sans démarrer. `join` peut être réutilisé : il
livre le résultat mémorisé même après la fin.

`join`, `onComplete` et `kill` retournent un **effet de désabonnement**. Le forcer
retire l'observateur et n'attend pas la fibre. Le résultat d'un join est
`Either Error a` ; le callback de kill reçoit `Right unit` à la fin de la fibre
cible. Le résultat de la fibre elle-même conserve son échec/annulation.
Les observateurs sont invoqués hors du moniteur, sur le thread qui publie la
fin ou sur le thread qui souscrit à une fibre déjà terminée.

La réservation de kill et celle de la complétion partagent le verrou de la
fibre. Une annulation acceptée conserve sa première cause ; les cancelers
s'exécutent ensuite hors des verrous. La complétion attend ces cancelers avant
de publier le résultat. Une fibre suspendue annulée ne lance pas son corps.

### Annulation, exceptions et ressources

- L'annulation est **coopérative**. Les checkpoints de l'interpréteur, les attentes
  `makeAff` (tranches de 20 ms) et les délais (tranches de 25 ms) la constatent.
  Un Effect Java bloquant doit finir ou fournir son propre protocole d'arrêt.
- `makeAff` possède un terminal atomique : première livraison ou annulation.
  Un callback synchrone peut arriver avant le retour du builder ; le canceler
  d'une action déjà livrée n'est pas exécuté. Un builder encore en cours lorsque
  l'annulation arrive inscrit son canceler au retour, avec la cause originale.
- Un callback tardif/après annulation est ignoré. La fin d'une action retire
  son inscription ; la réutilisation du même contexte ne réexécute pas cet
  ancien canceler.
- `AffError` est intercepté par `_catchError`, y compris pour un Throwable
  venant d'un Effect. `AffCancelled` garde une voie distincte que `attempt`
  n'absorbe pas.
- `bracketRun` masque acquisition et nettoyage avec un nouveau contexte qui
  conserve le superviseur. Après acquisition réussie, il choisit exactement un
  handler `completed`, `failed` ou `killed`. Un échec d'acquisition ne nettoie
  pas une ressource non acquise. Une exception du nettoyage se propage sans
  déclencher un deuxième handler et prend le pas sur le résultat du corps.
- Les exceptions des cancelers sont journalisées (`Aff canceler error`) sans
  remplacer la cause d'annulation, y compris lors d'une inscription tardive.
  Les exceptions des observateurs sont également journalisées et ne privent
  pas les autres observateurs de leur livraison. Un échec sans observateur
  actif absorbant est journalisé comme `Uncaught Aff error`.

### Supervision, parallèle et processus

Une fibre forkée hérite du superviseur courant. Celui-ci couvre aussi les
petits-enfants ; son état de fermeture empêche une inscription tardive de
s'échapper. `killAll` annule les enfants et attend leur sortie. Hors d'une
supervision, un simple fork possède sa propre durée de vie.

`ParAff` Apply sélectionne le premier échec, annule l'autre branche puis attend
les deux sorties ; l'annulation du frère ne remplace pas cet échec. En cas de
double succès, il applique la fonction de gauche au résultat de droite. Alt
sélectionne le **premier succès**, même nul ; si tout échoue, il retient le
premier échec. C'est une autre règle que `Promise.race`. Le contexte parent
annule les deux branches et les combinateurs attendent le nettoyage du perdant.

Les fibres utilisent des **threads ordinaires daemon**, un par fibre démarrée.
Le runtime n'a pas de scheduler de threads virtuels ni de pool bornant cette
allocation. La seule présence de fibres daemon ne maintient pas la JVM en vie.
Une entrée d'application/test attend donc explicitement sa fin utile ; les
erreurs journalisées d'une fibre détachée ne deviennent pas spontanément un
code de sortie du processus. La fixture `Main.awaitAff` montre cette frontière.

## Promesses

[Promise/Internal.java](../../javapurs-js-promise/src/Promise/Internal.java)
sépare `PromiseValue`/`PromiseResult`, distribution des réactions, coordinateur
`PromiseAll`, puis wrappers FFI.

1. `PromiseValue` commence pending. Une résolution/rejection revendique la
   première décision sous verrou ; les décisions suivantes n'ont aucun effet.
2. Résoudre avec une autre Promise l'adopte. Cette décision est déjà réservée
   pendant l'attente : un rejet ultérieur ne peut pas la remplacer. Se résoudre
   directement avec soi-même rejette avec `IllegalStateException`.
3. Le règlement publie un `PromiseResult` immuable, copie les observateurs,
   vide leur liste et les invoque hors du moniteur. Le payload peut être nul.

Les champs publics historiques `settled`, `failed`, `value` et `rejection` sont
une **vue de compatibilité**, utilisée notamment par la FFI applicative. Le
runtime publie le payload avant `settled` (volatile). Lire `settled` avant de
consulter un résultat potentiellement concurrent ; écrire par `resolveWith` ou
`rejectWith`. Les factories `resolved`/`rejected` restent disponibles, et
`resolved` retourne l'objet existant si son argument est déjà une Promise.

Les réactions sont **eager**, sur le thread qui règle ou souscrit. Une
trampoline par thread borne les chaînes synchrones ; son ThreadLocal est retiré
après drainage. Le snapshot d'observateurs déjà inscrits est enfilé avant les
réactions ajoutées réentrantes. Des threads différents peuvent distribuer des
réactions simultanément : il n'y a pas de file globale de microtasks JavaScript.

| Opération | Résultat et attente |
| --- | --- |
| `new` | Exécute l'exécuteur quand son Effect est forcé. Les callbacks resolve/reject sont des Functions retournant un Effect. Une exception de l'exécuteur rejette, si la première décision n'a pas déjà été prise. |
| `then_`, `thenOrCatch`, `catch` | Inscrivent au forçage ; allouent une Promise enfant. Propagent la branche sans handler, adoptent le résultat du handler ou rejettent avec son exception. |
| `finally` | Exécute le nettoyage au règlement et attend sa Promise. Préserve le résultat original en cas de succès du nettoyage, le remplace par l'échec du nettoyage sinon. |
| `all` | Attend chaque succès, conserve l'ordre d'entrée et les valeurs nulles ; un échec rejette. Un tableau vide réussit immédiatement avec un tableau vide. |
| `race` | Première livraison, succès **ou rejet** ; une course vide reste pending. Pour des entrées déjà réglées, l'ordre d'inscription est celui du tableau. |

Une Promise conserve ses observateurs jusqu'à son règlement. Son API ne fournit
pas d'annulation/désabonnement ; les entrées encore pending de `all`/`race`
conservent leurs réactions même après le règlement du résultat global. Une
exception de handler rejette sa Promise enfant ; le port n'a pas de rapporteur
global des rejets non observés.

## Pont Aff / Promise

[Promise/Aff.purs](../../javapurs-js-promise-aff/src/Promise/Aff.purs) est le
propriétaire du pont, sans fragment Java supplémentaire :

- `fromAff` démarre une fibre via `runAff_` au forçage de son Effect. Le succès
  règle la Promise ; l'échec Error la rejette en conservant l'objet.
- `toAff` inscrit ses callbacks lorsque l'Aff s'exécute. `toAffE` force d'abord
  l'Effect producteur. Un Throwable est reconnu, une chaîne devient Error, les
  autres valeurs reçoivent l'erreur de conversion générique.
- `toAff'` prend un coerceur personnalisé, qui doit retourner un Error. Lever
  pendant ce callback rejette la Promise intermédiaire ignorée par le pont,
  sans livrer l'Aff. La FFI transitive `Foreign` doit donc être disponible, même
  si tous les échanges réussis paraissent déjà fonctionner.
- L'annulation de l'Aff consommateur utilise le `nonCanceler` du pont : elle
  arrête l'attente, sans annuler le producteur ni retirer l'abonnement Promise.
  Son callback tardif est ignoré par le terminal de `makeAff` ; la Promise peut
  garder cette closure jusqu'à son règlement.

## Vérifications ciblées

Depuis le dépôt du compilateur :

```bash
node test/ffi-diagnostics.mjs
node test/ffi-runtimes.mjs
node test/ffi-ports.mjs
```

`ffi-diagnostics.mjs` construit huit modules Prim-only et vérifie sélection
adjacente/replis, états/empreintes du relevé, huit erreurs JVM nommant le binding,
deux bindings omis rejetés par `javac` et une erreur de lecture conservant l'ancien
manifeste. Backend construit, `purs` TAST et JDK sont nécessaires.

`ffi-runtimes.mjs` compile les vrais fragments avec un shim Either minimal : **4**
contrôles Ref, **14** Promise et **18** Aff. Il ne demande que Node, un JDK et les
trois ports voisins. Les barrières imposent les ordres de concurrence ; les
timeouts bornent un protocole bloqué. Les chaînes de 20 000 étapes s'exécutent
avec une pile de 512 Kio.

`ffi-ports.mjs` demande aussi le backend construit, Spago et `purs` TAST. Il compile
les vraies API PureScript et leurs ADT, puis exécute **17 assertions** dans
chacun des modes records typés et Maps sur le même TAST. Il attend la fibre
racine et propage son échec au processus ; le marqueur final est vérifié. Il
contrôle les chemins des fragments des ports, l'égalité du relevé entre les modes,
puis reconstruit avec `foreign` du registre pour constater son absence de Java.
Les quatre ports exposent un `bin/test-runtime` vers ces suites. La
[recette de test](testing.md#runtimes-ffi-et-interopérabilité) précise les options,
les preuves et les [suites de ports attendues](testing.md#suites-asynchrones-des-ports)
livrées en M12, avec leurs sondes de fin de processus.
