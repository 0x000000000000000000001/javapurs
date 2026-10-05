# Installation source et livraison d'une application

Procédure M15, **5 octobre 2026**. Le [README](../README.md#build-the-backend)
donne la commande d'installation ; cette page précise ses entrées, preuves et
possibilités de rejeu. Les [preuves M15](testing.md#validation-m15) consignent les
deux reconstructions isolées et leurs limites.

## Références et prérequis

[tools/source-lock.json](../tools/source-lock.json) fixe les sept révisions Git
complètes : fork PureScript, PBO et ports `foreign-object`, `prelude`, `effect`,
`console`, `refs`. Le checkout Javapurs qui lance l'installation est la source du
backend : sa révision, son état modifié et les SHA-256 des fichiers exportés sont
consignés dans `installation.json`. Une branche distante mobile ne remplace jamais
les références des dépendances.

- **Node 24.8.0**, **Spago 1.0.3**, **Stack 3.11.1**, Git et Bash sont les outils
  de la recette mesurée. L'installateur exige Spago 1.0.3 et relève les autres
  versions réellement employées.
- Stack utilise le `stack.yaml` et le `stack.yaml.lock` du fork : snapshot
  **lts-23.18**, **GHC 9.8.4**, commit de `cheapskate` et empreintes Hackage.
  Le `ghc` global peut être d'une autre version. Les prérequis natifs GHC/Stack
  doivent être disponibles : outils de compilation et SDK système sur macOS,
  notamment les Command Line Tools Xcode ; compilateur C, GMP, zlib et libtinfo
  suivant la distribution Linux. Voir aussi l'[installation du fork](../../../purescript/INSTALL.md).
- Un JDK complet est résolu par [java-tools.mjs](../tools/java-tools.mjs), puis
  `jar` est pris dans le même dossier réel que `javac` et `java`. La recette
  compile en **release 17 par défaut** via `JAVAPURS_JAVA_RELEASE` et exécute sur
  le JDK choisi, ou la JVM explicitement fournie par `JAVAPURS_JAVA_RUNTIME`.
  Les preuves distinguent cette cible de la JVM effective ; voir la
  [configuration commune](testing.md#build-jdk-cible-et-jvm).
- Réseau vers GitHub, les sources Stack/Hackage et le registre Spago, ou caches
  correspondants disponibles. Les checkouts et builds de projets sont neufs ;
  les caches utilisateur de dépendances Stack et Spago sont partagés. Il s'agit
  d'une reconstruction source à références fixées, pas d'une image système
  hermétique ni d'une promesse de binaires/JAR identiques octet pour octet.

Le [lockfile du backend](../spago.lock) conserve le graphe du package set
**77.10.1**, y compris les dépendances de PBO. Les packages locaux restent des
chemins Spago ; leur contenu est fixé par les commits du manifeste source.

## Parcours exécuté

[install-source.mjs](../tools/install-source.mjs) accepte un unique dossier neuf.
Les prérequis sont contrôlés avant sa création. L'installation :

1. Exporte les fichiers `src/`, `bin/`, `tools/`, `examples/`, `spago.yaml`,
   `spago.lock` et `README.md` de l'arbre courant. Les fichiers suivis et les
   nouvelles sources non ignorées sont inclus, avec leurs SHA-256. Le build
   versionné `output/` et le cache `.spago/` ne font pas partie de cet export.
2. Fetch chaque dépendance par SHA Git, puis vérifie `HEAD`. Le sparse checkout
   exclut les arbres générés `output`, `java_output`, `.spago` et `logs` que
   certains ports versionnent. Les sources et métadonnées de build restent celles
   du commit annoncé.
3. Lance `stack build purescript:exe:purs --copy-bins --local-bin-path …/bin`
   dans le fork neuf, avec `--stack-yaml` explicite et `--lock-file error-on-write`.
   Relève le chemin GHC choisi par Stack, puis le chemin, la version et le SHA-256
   du `purs` ainsi produit.
4. Place ce `purs` en tête du `PATH` et lance [build.mjs](../tools/build.mjs)
   depuis le backend exporté. La sonde `Probe` n'a aucune dépendance externe ;
   ses déclarations de donnée et classe et son identité `Int -> Int` doivent
   produire des tableaux **non vides** `dataDecls`, `classDecls`, `typeTable`.
   `builtWith`, tailles et empreinte sont consignés dans le log de build et
   `installation.json.tastProbe`.
5. Exécute `spago build` : Javapurs, PBO et leurs dépendances PureScript sont
   reconstruits depuis les sources ; l'empreinte du lockfile doit rester identique.
   Le launcher du workspace pointe sur ce build.
6. Lance [source-smoke.mjs](../tools/source-smoke.mjs) : exemples Hello et Refs,
   Spago/TAST/Java, `javac --release N` (17 par défaut), classes exécutées, création de chaque
   JAR et exécution depuis un dossier séparé contenant uniquement `app.jar`.

Chaque phase a sa commande, son répertoire et un log. `installation.json` porte
`status: "passed"` seulement après la dernière exécution attendue. Un échec laisse
`status: "failed"`, son diagnostic et les fichiers/logs disponibles. Un dossier
existant est refusé ; le rejeu complet prend un nouveau nom.

## Exemples et FFI transitive

- [Hello](../examples/hello/src/Main.purs) utilise sa propre
  [FFI Java](../examples/hello/src/Main.java), telle que reproduite dans le README.
  `prelude` et `effect` proviennent du registre pour leurs définitions PureScript.
- [Refs](../examples/refs/src/Main.purs) construit une référence contenant `40`,
  la modifie de `+2`, la lit et affiche `42`. Son
  [spago.yaml](../examples/refs/spago.yaml) sélectionne `refs`, `console`,
  `effect` et `prelude` locaux : les deux derniers fournissent aussi les
  implémentations FFI utilisées par les premiers. Les chemins de cet exemple
  décrivent `workspace/apps/refs`.
- Le smoke vérifie le résultat réel et le relevé FFI `provided` de `Effect`,
  `Effect.Ref`, `Effect.Console`, avec le chemin réel du fragment du port attendu.
  Il vérifie aussi la version majeure du bytecode du launcher (**61** pour Java 17).
  Le relevé complet, les empreintes des JAR et du
  TAST principal, la version `builtWith`, le lockfile applicatif et l'inventaire
  Java sont enregistrés dans `apps/smoke.json` et `installation.json`.
  Cette exécution couvre les opérations de l'exemple, pas tous les bindings de
  ces ports. Le champ de couverture du relevé reste `not-checked`.

Pour rejouer seulement les applications avec les outils installés, depuis
n'importe quel répertoire, en conservant le workspace initial :

```bash
export JAVAPURS_WORKSPACE="/chemin/vers/javapurs-workspace"
export PATH="$JAVAPURS_WORKSPACE/bin:$PATH"
node "$JAVAPURS_WORKSPACE/javapurs/javapurs/tools/source-smoke.mjs" \
  "$JAVAPURS_WORKSPACE" "$JAVAPURS_WORKSPACE/replay-apps"
```

`replay-apps` doit être neuf. La commande rebase les chemins des ports et crée de
nouveaux TAST, Java et classes. Pour reproduire le backend, conserver son checkout
à la révision indiquée dans `installation.json.backend.revision` et les éventuelles
modifications décrites par `backend.dirty` et l'inventaire `backend.files` ; le
snapshot exporté contient les octets effectivement compilés.

## Diagnostics et artefacts à transmettre

| Symptôme | Localisation et correction |
| --- | --- |
| Exécutable absent | Le build/installateur nomme l'outil ; corriger `PATH`, ou `JAVA_HOME`/`JAVAC`/`JAVA` pour le JDK. `jar` est vérifié séparément. |
| Dépendance locale absente | `bin/build` nomme le `spago.yaml` absolu attendu pour PBO ou `foreign-object` ; reprendre le layout ou l'installation source. |
| Version Spago différente | La recette source indique la version exigée et le binaire trouvé avant tout fetch. |
| TAST incompatible malgré `purs --version` correct | La sonde nomme le binaire, le JSON produit et la métadonnée manquante/mal formée. Mettre le fork épinglé sur `PATH` et reconstruire dans un output neuf. Ce contrôle porte sur le compilateur sélectionné au build ; il ne certifie pas d'anciens caches applicatifs. |
| Échec `load TAST from …` à la génération Java | Le [lecteur applicatif](compiler.md#2-chargement-tast-et-optimisation-pbo) vérifie chaque CoreFn, les trois tableaux enrichis, les noms uniques et les imports présents. Reconstruire l'entrée avec le fork sélectionné ; le diagnostic nomme le fichier ou la dépendance fautive et l'ancienne sortie Java est préservée. |
| Backend absent/incomplet | Le launcher nomme le module JS introuvable et le `bin/build` à appeler. |
| Échec Stack, fetch, Spago ou JVM | La phase et le log sont indiqués ; les sources partielles sont conservées. |

Pour **reconstruire** : conserver le checkout/snapshot du backend, le manifeste
source, ses configurations/lockfiles, les sources/FFI de l'application et
`installation.json`. Les outils natifs et les sources de dépendances doivent
rester accessibles selon les références annoncées.

Pour **exécuter les deux exemples** : transmettre **`app.jar` et une JVM compatible**.
Node, PureScript, PBO, Spago, sources, TAST et Java généré servent à la construction.
Une application utilisant des bibliothèques Java tierces doit aussi livrer ses
JAR de dépendances et configurer leur classpath ; voir le
[README](../README.md#compile-and-run-an-application).
