# Démarrer et valider

Depuis le dépôt du compilateur `javapurs/javapurs/`, choisir le contrôle adapté
au changement. La [carte du code](code-map.md) indique le module responsable.

## Prérequis

- Node.js et Bash ; la recette source a été exercée avec Node **24.8.0**.
- Spago **1.0.3**, les dépendances locales de `spago.yaml` et le **fork PureScript
  capable de produire le TAST**. Un `purs` standard de même version ne suffit pas.
- Pour les suites Java, un **JDK complet 17+**. Sélectionner son répertoire avec
  `JAVA_HOME` ou ses exécutables avec `JAVAC`/`JAVA` ; voir la
  [résolution des outils](testing.md#build-jdk-cible-et-jvm).

L’[installation source](installation.md) fournit un workspace contenant le fork
et le backend. Pour utiliser ce workspace, adapter le chemin puis sélectionner
ses binaires avant toute reconstruction :

```sh
export JAVAPURS_WORKSPACE="/chemin/vers/javapurs-workspace"
export PATH="$JAVAPURS_WORKSPACE/bin:$PATH"
command -v purs
./bin/build
```

Dans un checkout existant, placer de la même manière le dossier contenant le
`purs` du fork en tête de `PATH`. `bin/build` imprime les outils retenus puis
compile une sonde exigeant `dataDecls`, `classDecls` et `typeTable` avant Spago.
Cette sonde établit la capacité TAST ; `purs --version` seul ne l’établit pas.
Le launcher `bin/javapurs` charge les modules construits et ne les reconstruit pas.

## Vérification minimale

Pour les guides ou leurs liens, Node et Bash suffisent :

```sh
node tools/check-docs.mjs
git diff --check
```

Pour vérifier la cohérence du workspace après une modification :

```sh
node tools/check-all.mjs --quick
```

Ce profil vérifie la documentation, les configurations, la matrice FFI et les
sorties générées. **Il reconstruit le backend** pour comparer les sorties : le
fork TAST, Spago et les dépendances locales sont donc nécessaires. Après une
modification des sources, lancer d’abord `./bin/build` pour actualiser les sorties
suivies, puis le contrôle de stabilité.

Choisir ensuite les suites du composant modifié dans la
[matrice des tests](testing.md#matrice-des-tests). Par exemple :

```sh
node test/typed-records.mjs
../javapurs-node-fs/bin/test
```

Pour la sélection d’intégration commune :

```sh
node tools/check-all.mjs --full
```

`--full` inclut `--quick`, puis test-tools, child-process, Spec et Node FS.
Il ne lance pas toutes les suites du compilateur ni tous les ports. Inutile de
lancer `--quick` séparément juste avant. Les logs sont dans `logs/check-all/` ;
le runner conserve les workspaces en échec et indique leur chemin.

## Lire le dépôt

1. [Carte du code](code-map.md) : pipeline, modules, harnais et artefacts.
2. [Guide du compilateur](compiler.md#suivre-une-compilation) : flux détaillé.
3. [Tests ciblés](testing.md#matrice-des-tests) : matrice et commandes.
4. [Matrice FFI des ports](port-ffi.md) : surface et limites ;
   [contrats runtime](ffi-runtime.md) pour les conventions communes.
5. [Maintenance](maintenance.md) : sources de référence, sorties et conservation.

Les campagnes terminées sont dans [l’historique](validation-history.md).
