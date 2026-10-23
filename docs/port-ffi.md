# Matrice FFI des ports

Cette matrice relie chaque port à ses fichiers Java FFI, son profil de validation
et ses limites connues. Les chemins sont relatifs au checkout `javapurs-<port>`.
Le contrôle `node tools/check-port-ffi.mjs` vérifie la présence des lignes,
l’existence de chaque fichier listé et de son module PureScript adjacent.
Le [guide de maintenance des ports](port-maintenance.md) explique le layout,
la sélection des dépendances locales et le choix des validations.

## Ports standards

| Port | Profil | FFI Java | Limites |
| --- | --- | --- | --- |
| `aff` | awaited (Aff) | `src/Effect/Aff.java` | Threads daemon; annulation coopérative. |
| `promise` | awaited (Promise) | `src/Promise/Internal.java`<br>`src/Promise/Rejection.java` | Callbacks eager; adoption; rejets objet. |
| `promise-aff` | awaited (Aff) | — | Pont via Promise.Rejection; dépend de foreign. |
| `arrays` | synchronous | `src/Data/Array/NonEmpty/Internal.java`<br>`src/Data/Array/ST/Partial.java`<br>`src/Data/Array/ST.java`<br>`src/Data/Array.java` | — |
| `assert` | synchronous | `src/Test/Assert.java` | — |
| `avar` | synchronous | `src/Effect/AVar.java` | — |
| `catenable-lists` | synchronous | — | — |
| `console` | synchronous | `src/Effect/Console.java` | — |
| `datetime` | synchronous | `src/Data/Date.java`<br>`src/Data/DateTime/Instant.java`<br>`src/Data/DateTime.java` | — |
| `effect` | synchronous | `src/Effect/Uncurried.java`<br>`src/Effect/Unsafe.java`<br>`src/Effect.java` | — |
| `enums` | synchronous | `src/Data/Enum.java` | — |
| `foldable-traversable` | synchronous | `src/Data/Foldable.java`<br>`src/Data/FunctorWithIndex.java`<br>`src/Data/Traversable.java` | — |
| `foreign` | synchronous | `src/Foreign/Index.java`<br>`src/Foreign/Keys.java`<br>`src/Foreign.java` | `undefined` distinct de `null`; index/tableaux. |
| `foreign-object` | synchronous | `src/Foreign/Object/ST.java`<br>`src/Foreign/Object.java` | — |
| `free` | synchronous | — | — |
| `functions` | synchronous | `src/Data/Function/Uncurried.java` | — |
| `integers` | synchronous | `src/Data/Int/Bits.java`<br>`src/Data/Int.java` | — |
| `js-date` | synchronous | `src/Data/JSDate.java` | Parsing/format ISO. |
| `lazy` | synchronous | `src/Data/Lazy.java` | — |
| `node-buffer` | synchronous | `src/Node/Buffer/Constants.java`<br>`src/Node/Buffer/Immutable.java`<br>`src/Node/Buffer.java`<br>`src/Node/Encoding.java` | Fenêtres/copies byte[] explicites. |
| `node-event-emitter` | awaited (Spec) | `src/Node/EventEmitter.java`<br>`src/Node/Symbol.java` | `once`, rejeu borné des streams, exceptions. |
| `node-fs` | synchronous | `src/Node/FS/Async.java`<br>`src/Node/FS/Constants.java`<br>`src/Node/FS/Stats.java`<br>`src/Node/FS/Stream.java`<br>`src/Node/FS/Sync.java` | Stats non-POSIX en repli; streams de fichiers. |
| `node-http` | synchronous | `src/Node/HTTP/ClientRequest.java`<br>`src/Node/HTTP/IncomingMessage.java`<br>`src/Node/HTTP/OutgoingMessage.java`<br>`src/Node/HTTP/Server.java`<br>`src/Node/HTTP/ServerResponse.java`<br>`src/Node/HTTP.java`<br>`src/Node/HTTPS.java` | Upgrade 101; URL externes opt-in. |
| `node-net` | synchronous | `src/Node/Net/BlockList.java`<br>`src/Node/Net/Server.java`<br>`src/Node/Net/Socket.java`<br>`src/Node/Net/SocketAddress.java`<br>`src/Node/Net.java` | Cycle socket local; adresse `Nullable`. |
| `node-path` | synchronous | `src/Node/Path.java` | — |
| `node-process` | synchronous | `src/Node/Process.java` | — |
| `node-streams` | synchronous | `src/Node/Stream.java` | Historique borné; pas de backpressure OS. |
| `now` | synchronous | `src/Effect/Now.java` | — |
| `nullable` | synchronous | `src/Data/Nullable.java` | — |
| `numbers` | synchronous | `src/Data/Number/Format.java`<br>`src/Data/Number.java` | — |
| `ordered-collections` | synchronous | — | — |
| `partial` | synchronous | `src/Partial/Unsafe.java`<br>`src/Partial.java` | Sentinel Undefined -> `null` documenté. |
| `prelude` | synchronous | `src/Control/Apply.java`<br>`src/Control/Bind.java`<br>`src/Data/Bounded.java`<br>`src/Data/Eq.java`<br>`src/Data/EuclideanRing.java`<br>`src/Data/Functor.java`<br>`src/Data/HeytingAlgebra.java`<br>`src/Data/Ord.java`<br>`src/Data/Reflectable.java`<br>`src/Data/Ring.java`<br>`src/Data/Semigroup.java`<br>`src/Data/Semiring.java`<br>`src/Data/Show/Generic.java`<br>`src/Data/Show.java`<br>`src/Data/Symbol.java`<br>`src/Data/Unit.java`<br>`src/Record/Unsafe.java` | — |
| `quickcheck` | synchronous | `src/Test/QuickCheck/Gen.java` | — |
| `random` | synchronous | `src/Effect/Random.java` | — |
| `record` | synchronous | `src/Record/Builder.java`<br>`src/Record/Unsafe/Union.java` | — |
| `refs` | synchronous | `src/Effect/Ref.java` | — |
| `exceptions` | synchronous | `src/Effect/Exception.java` | — |
| `run` | synchronous | — | — |
| `spec` | awaited (SpecFull) | `src/Test/Spec/Assertions/String.java`<br>`src/Test/Spec/Assertions.java`<br>`src/Test/Spec/Console.java`<br>`src/Test/Spec/Runner.java` | — |
| `st` | synchronous | `src/Control/Monad/ST/Internal.java`<br>`src/Control/Monad/ST/Uncurried.java` | — |
| `strings` | synchronous | `src/Data/String/CodePoints.java`<br>`src/Data/String/CodeUnits.java`<br>`src/Data/String/Common.java`<br>`src/Data/String/Regex.java`<br>`src/Data/String/Unsafe.java` | FFI des dépendances fournie par prelude, enums et integers. |
| `strings-extra` | synchronous | `src/Data/String/Extra.java` | FFI propre; dépendances via ports. |
| `unfoldable` | synchronous | `src/Data/Unfoldable.java`<br>`src/Data/Unfoldable1.java` | — |
| `unsafe-coerce` | synchronous | `src/Unsafe/Coerce.java` | — |
| `uuid` | awaited (Spec) | `src/Data/UUID.java` | — |
| `variant` | synchronous | — | — |
| `yoga-json` | awaited (Spec) | `src/Yoga/JSON.java` | — |

## Ports auxiliaires

| Port | Configuration | FFI Java | Statut |
| --- | --- | --- | --- |
| `argonaut-core` | `spago.yaml` | `src/Data/Argonaut/Core.java`<br>`src/Data/Argonaut/Parser.java` | Dépendance transitive. |
| `control` | `spago.yaml` | `src/Control/Extend.java` | Dépendance transitive. |
| `js-bigints` | `spago.yaml` | `src/JS/BigInt.java` | Dépendance transitive. |
| `js-uri` | `spago.yaml` | `src/JSURI.java` | Dépendance transitive. |
| `node-child-process` | `spago.yaml` | `src/Node/ChildProcess.java`<br>`src/Node/ChildProcess/Types.java`<br>`src/Node/UnsafeChildProcess/Safe.java`<br>`src/Node/UnsafeChildProcess/Unsafe.java` | Test compilateur `test/child-process.mjs` ; spawn seulement, exec/spawnSync/IPC non supportés. |
| `spec-discovery` | `spago.java.yaml` | `src/Test/Spec/Discovery.java` | Configuration consommée par Spec ; pas de launcher. |
| `unsafe-reference` | `spago.yaml` | `src/Unsafe/Reference.java` | Dépendance transitive. |

## Limites notables

- `node-fs` : les attributs POSIX indisponibles restent à zéro ; les streams de fichiers utilisent l’historique borné.
- `node-net` / `node-http` : le socket local et l’upgrade 101 sont couverts ; les URL HTTP externes sont opt-in.
- `node-event-emitter` / `node-streams` : l’EventEmitter général ne rejoue pas les événements ; les streams et `ChildProcess` ont un historique borné.
- `node-child-process` : surface volontairement partielle (spawn/stdout/exit), documentée dans `docs/ffi-runtime.md`.
- `foreign` : `Foreign.undefined` est un sentinel distinct de `JSON null`.

## Vérification

```sh
node tools/check-port-ffi.mjs
```
