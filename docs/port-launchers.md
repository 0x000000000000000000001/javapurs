# Inventaire des launchers de ports

Relevé M23 du **6 octobre 2026**. Les **45 launchers historiques**, pilotes M22
inclus, délèguent désormais à `javapurs/test/port-runners.mjs --port=NOM`.
Chaque nom du tableau désigne le dépôt voisin `javapurs-NOM`, son `bin/test`
et la sélection correspondante dans [port-test-runner](../tools/port-test-runner.mjs).
Les trois launchers Aff/Promise/Promise-Aff déjà migrés portent le total à **48**.
Voir les [commandes et prérequis](testing.md#port-particulier) et les
[résultats M23](testing.md#validation-m23).

## Contrat commun et configurations

- Les 45 profils conservent leur propre `spago.java.yaml`, son package set
  **77.7.0**, ses listes de dépendances package/test et ses sélections locales.
  Les chemins sont rebasés depuis ce gabarit. Prelude et Partial ont une liste
  directe vide explicite `[]` ; elle reste vide dans le workspace préparé.
- Le module source est toujours **`Test.Main`**. Les arbres **`src/` et `test/`**
  sont copiés pour les profils exécutables avec leur structure, leurs FFI
  `.java`/`.js` et leurs ressources.
  Les chemins du tableau sont relatifs au port. Le gabarit conserve
  `test.main: Test.Main` ; UUID/Event Emitter génèrent `Test.PortRunner`.
- La pile JVM est **`-Xss8m`**, sauf Strings : **`javac -J-Xss64m` et
  `java -Xss64m`**. La cible reste `JAVAPURS_JAVA_RELEASE`, 17 par défaut ;
  `JAVAPURS_JAVA_RUNTIME` peut sélectionner une JVM d'exécution distincte.
- Console contient `test/expected_output.txt`, copié comme ressource ; son
  entrypoint historique imprime des messages, sans comparaison automatique à
  ce fichier. Partial est un smoke test compilation/appel, sans assertions.
- Node FS référence `test/Test.purs`, `test/fixtures/readable.txt`, et crée
  `tmp/` et des dossiers temporaires sous `test/`. Cinq anciens
  `test/node-fs-tests*/readable.txt` sont présents dans le checkout initial :
  leur présence est enregistrée et préservée. Son protocole est rejeté avant
  préparation ; aucune opération de fichiers de cette suite n'est lancée.
- Spec dépend aussi de **`integration-tests/cases/`** (`Main.purs`, `output.txt`)
  et **`integration-tests/env-template/`**. `test/Integration.purs` copie ce
  gabarit, rebase `SPEC_REPO_PATH`, appelle `npm`/`npx spago` et gère des caches
  `node_modules`/`output` dans cet arbre externe à `test/`. Le rejet préalable
  préserve l'ensemble ; un futur adaptateur devra isoler aussi ces ressources.
- Les dossiers de benchmarks séparés (`arrays/bench`, `catenable-lists/benchmarks`,
  `free/benchmark`, etc.) ne sont pas des entrées de `Test.Main`. Les fichiers
  de test historiques, y compris `Bench.purs` lorsqu'il existe sous `test/`,
  restent dans la copie. Les trois profils M12 ont leur exclusion existante de
  `Bench.purs`, leurs tests copiés sous `src/` et le package set **77.10.1**.

## Références et sélection réelle

État initial : **42 ports propres** ; Refs, Exceptions et Strings ont déjà
`README.md` et `bin/test` modifiés par M22. Les révisions ci-dessous sont celles
relevées avant M23, sans commit intermédiaire.

Protocoles : **S** = retour synchrone de `Effect Unit` ; **F** = retour synchrone
d'une fonction appelée par `MainRun` (`Function.apply(null)`) ; **A** = Spec/Aff
attendu, résultats vérifiés ; **U** = protocole non pris en charge, sortie 1
avant outils/build/workspace. Les **45 délégations** sont exercées avec commandes
simulées. « Non exécuté » concerne seulement la suite réelle du port.

| Nom / sélection | Révision initiale | Entrypoint source | Protocole | Résultat réel M23 |
| --- | --- | --- | --- | --- |
| `arrays` | `e4c716465a7502a15e8d8186b2cac988bbddf236` | `test/Test/Main.purs` | S | Réussi |
| `assert` | `b2afe887ddf134a13d02845bf7127918b48ac452` | `test/Test/Main.purs` | S | Non exécuté |
| `avar` | `9f2f3d167d6677311a24d776ee1c9abdc322ad01` | `test/Main.purs` | S | Non exécuté |
| `catenable-lists` | `430a4b080572e08cf1fb5ff0cf671dc9cc16882b` | `test/Test/Main.purs` | S | Non exécuté |
| `console` | `a8ed05c2157db5038231255bf10d9ac42700300b` | `test/Main.purs` | S | Réussi ; ressource texte copiée |
| `datetime` | `efea1c44ffa89f505fe427b8cdc076f7c55a45c5` | `test/Test/Main.purs` | S | Non exécuté |
| `effect` | `a02ef943d75f2c6669befcb0c304f86f8195706f` | `test/Main.purs` | S | Non exécuté |
| `enums` | `014abb5778603beb2675c8fd29117f59c3aead8e` | `test/Main.purs` | S | Non exécuté |
| `exceptions` | `d47b968ffe098b66c6e5573ee4f7c23c4d57c8f2` | `test/Main.purs` | S | Réussi ; pilote M22 |
| `foldable-traversable` | `261977e15514c003422c511887d9719f4cc66f70` | `test/Main.purs` | S | Non exécuté |
| `foreign` | `c7d5403aea3ea607d731987d6406418a0e5d4cce` | `test/Main.purs` | S | Non exécuté |
| `foreign-object` | `c1b52a1beedd9a8e7e4b658c17dcba9982283176` | `test/Test/Main.purs` | S | Non exécuté |
| `free` | `5c56ae4d8455bb0478abd0e5ad493ca813b745af` | `test/Test/Main.purs` | S | Non exécuté |
| `functions` | `3a58efdce523d0525aa1a7621be38d76dbc7d0f9` | `test/Test/Main.purs` | S | Non exécuté |
| `integers` | `d9691a2e05f32a3156e506e56ceb6bdfd3ff4622` | `test/Test/Main.purs` | S | Non exécuté |
| `js-date` | `02782d15e717279b95cead33acbcc3b33728bbcd` | `test/Test/Main.purs` | S | Non exécuté |
| `lazy` | `576e72e31a0404610ad9fb7de5416220b0689060` | `test/Test/Main.purs` | S | Non exécuté |
| `node-buffer` | `44c2530e14c54e42b058fe79cd00e07823d092f3` | `test/Test/Main.purs` | S | Non exécuté |
| `node-event-emitter` | `bfc9196b75fe4f9db81f75d7da9ced2252194a1e` | `test/Test/Main.purs` | A | Échec préexistant : 1/14 ; cinq sondes du wrapper réussies |
| `node-fs` | `5b98beca764c716b4e232d12d141bf6684d88e4a` | `test/Main.purs` | U | Rejet 1 vérifié |
| `node-http` | `8cb44f5296cc85a3014bc4c0e3b93db02dfd71a3` | `test/Main.purs` | U | Rejet 1 vérifié |
| `node-net` | `1f46812560587cb33bc67d761049c927a9a6ac00` | `test/Test/Main.purs` | U | Rejet 1 vérifié |
| `node-path` | `c859522b7732636707434b403827aa97bed6d74f` | `test/Test/Main.purs` | S | Réussi |
| `node-process` | `bf7383e43165556947026f463eb2985daec363ef` | `test/Test/Main.purs` | S | Non exécuté |
| `node-streams` | `bc00afaa94fe01dc3cc173e402e15e3f395d5c96` | `test/Main.purs` | U | Rejet 1 vérifié |
| `now` | `55181bd2e32b004d56d74741a6103167bf45fbcb` | `test/Main.purs` | S | Non exécuté |
| `nullable` | `883b23bd9f7b51448246fd071ca99e26c2a17bda` | `test/Main.purs` | S | Non exécuté |
| `numbers` | `52e949c54ede4753c8efa52d79adf9bf64130c0a` | `test/Test/Main.purs` | S | Non exécuté |
| `ordered-collections` | `5b72c3bbef11583c498457d5abfda579299426b0` | `test/Test/Main.purs` | S | Non exécuté |
| `partial` | `f22b6cb8779f5ff1da92b5ea7c9556db5535b639` | `test/Main.purs` | F : `forall a. a -> {}` | Réussi ; smoke test |
| `prelude` | `91950bc3ae440ac2712323d852fabaf5c0b12431` | `test/Test/Main.purs` | F : `AlmostEff = Unit -> Unit` | Réussi |
| `quickcheck` | `d68329642558df5ddd0621f0f02dc17737f6158b` | `test/Main.purs` | S | Non exécuté |
| `random` | `bc501fea3661b45da9c78cedb15e0d27bed3f03e` | `test/Test/Main.purs` | S | Non exécuté |
| `record` | `ba2f8d446bde4f1d5dc8308e66ca264e58490fd6` | `test/Main.purs` | S | Non exécuté |
| `refs` | `c8e66b9acde8dda2a0e7271fb4175dd20cf3d5ae` | `test/Main.purs` | S | Réussi ; pilote M22 |
| `run` | `95e99b98920d6b0af61f214805efbdb0f54dfb12` | `test/Main.purs` | S | Non exécuté |
| `spec` | `94a410b9df324cea7f7947ec39a119dcbf8158bd` | `test/Main.purs` | U | Rejet 1 vérifié |
| `st` | `c65958662adbaa15aa5ec0696cc01f19f23a6f2b` | `test/Main.purs` | S | Non exécuté |
| `strings` | `f769f61f6c1b1eb07a7c33f8ea362c9f391a0d70` | `test/Test/Main.purs` | S ; piles 64 Mio | Réussi ; pilote M22 |
| `strings-extra` | `c7dd14feaca6bec544851085d59d730418102275` | `test/Main.purs` | S | Non exécuté |
| `unfoldable` | `f4c607bceb8375b25500d596e10b8a81b56a8786` | `test/Main.purs` | S | Non exécuté |
| `unsafe-coerce` | `37d502528a8f21e6b9b2e27a8693f6449af23e70` | `test/Main.purs` | S | Non exécuté |
| `uuid` | `6a254f8475eb22c8ed15cb1b6aef2c83a1f6037a` | `test/Main.purs` | A | Six tests et cinq sondes réussis |
| `variant` | `82bb0cfdab2ecca6dc3dcc9a36909366d1fee91a` | `test/Main.purs` | S | Non exécuté |
| `yoga-json` | `e1d20e158e262ad613ddd956a070869ff72b87e9` | `test/Main.purs` | U | Rejet 1 vérifié |

## Protocoles attendus et limites explicites

UUID et Node Event Emitter exposent leur **Spec originale** sans changer ses
assertions. `Spec.purs` utilise `evalSpecT` avec `exit = false`, attend l'Aff,
rejette les résultats en échec ou pending, puis annonce le nombre de succès.
Le launcher exige **6/14 résultats** et le marqueur final unique. Un simple
`runSpec' { exit = false }` aurait perdu les erreurs capturées dans l'arbre de
résultats. Le cinquième contre-exemple vérifie précisément ce cas.

Les six profils U restent enregistrés avec leurs sources et configuration :

| Port | Obstacle au protocole de fin |
| --- | --- |
| Node FS | Quatre suites mélangent opérations sync, callbacks, streams et `launchAff_`, sans action commune attendable. |
| Node HTTP | Serveurs HTTP/HTTPS, timers et Aff détachés ; aucune jonction globale. |
| Node Net | Retour après enregistrement de callbacks TCP/serveur/socket. |
| Node Streams | Assertions dans des callbacks de streams sans signal de fin. |
| Spec | `launchAff_`, CLI et sortie de processus `spec-node`, avec sous-processus d'intégration. |
| Yoga JSON | `launchAff_`, découverte dynamique de modules `spec-discovery`, puis sortie `spec-node`. |

Leurs commandes échouent explicitement même avec `--clean` ; `--help` reste
consultable sans outils Java. Adapter ces suites requiert une action attendable
préservant toutes leurs assertions et ressources. Les suites non exécutées et
les diagnostics de FFI manquante restent des limites de couverture distinctes
de la migration des launchers.
