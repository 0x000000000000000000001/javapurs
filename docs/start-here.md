# Démarrer et valider

Page courte pour reprendre le dépôt ou vérifier un changement ciblé. Pour la
cartographie complète, lire ensuite [la carte du code](code-map.md).

## Prérequis

- Node.js 22+ et Bash.
- Spago 1.x et le `purs` compatible TAST déjà installé.
- Un JDK 17+ ; les runners utilisent `JAVA_HOME`/`JAVAC`/`JAVA` lorsqu’ils sont
  fournis.
- Le compilateur construit : `./bin/build` depuis `javapurs/javapurs/`.

## Vérification minimale

```sh
./bin/build
node test/entrypoint.mjs
node test/child-process.mjs
node --test test/test-tools.mjs
node tools/check-port-configs.mjs
node tools/port-configs.mjs --check
node tools/check-port-ffi.mjs
node tools/check-generated.mjs
node tools/check-docs.mjs
node tools/check-all.mjs --quick
node tools/check-all.mjs --full
```

Pour un port précis, lancer sa suite ciblée :

```sh
../javapurs-node-fs/bin/test
../javapurs-spec/bin/test
```

Ne pas lancer `t -c`, le corpus complet ou `modtest` pour un cleanup : les
validations ciblées sont la règle du [plan v7](../todo.md).

## Lire le dépôt

1. [Carte du code](code-map.md) : pipeline, modules, harnais et artefacts.
2. [Guide du compilateur](compiler.md#suivre-une-compilation) : flux détaillé.
3. [Tests ciblés](testing.md#matrice-des-tests) : matrice et commandes.
4. [Contrats FFI](ffi-runtime.md#contrats-communs-des-ports-java-m03) : ports Java.
5. [Maintenance](maintenance.md) : artefacts, reprise et points ouverts.

Les récits de validation anciens sont dans
[l’historique](validation-history.md), pas dans le parcours quotidien.
