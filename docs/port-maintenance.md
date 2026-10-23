# Maintenir un port Java

Les 55 dossiers `javapurs-*` fournissent les bibliothèques de l'écosystème.
La [matrice FFI](port-ffi.md) donne les fragments et limites de chacun ;
48 ports ont une suite autonome et sept sont des dépendances auxiliaires.
Chaque README conserve la documentation de l'API amont et indique son entrée JVM.
La [revue du 23 octobre 2026](validation-history.md#entretien-des-ports-du-23-octobre-2026)
consigne les nettoyages et leurs validations ciblées.

## Où intervenir

| Fichier | Rôle |
| --- | --- |
| `src/**/*.purs` | API et implémentation PureScript. Conserver les noms et types publics lors d'un nettoyage. |
| `src/**/*.java` | Implémentation JVM des imports étrangers du module PureScript adjacent. Le compilateur insère ces membres dans la classe du module. |
| `src/**/*.js` | FFI du backend JavaScript amont ; ces fichiers restent utiles aux tests et comparaisons JavaScript. |
| `test/` | Tests de l'API. Les fixtures Java et JavaScript y accompagnent leurs modules PureScript. |
| `spago.java.yaml` | Configuration de la suite JVM standard, copiée et adaptée par le runner commun. |
| `spago.yaml` des auxiliaires | Dépendances du package local. L'auxiliaire est validé dans une application ou une suite qui le consomme. |
| `spago.dhall`, `packages.dhall`, `package.json` | Métadonnées et outils hérités de l'amont ; les commandes npm/Pulp ne lancent pas la suite JVM. |
| `bin/test` | Délégation au runner commun du compilateur voisin ; les phases et profils vivent dans `javapurs/tools/`. |
| `output/`, `.spago/`, `.purmeta/`, classes et logs | Résultats régénérables, distincts des sources maintenues. |

Un fragment Java n'est pas une classe autonome à déplacer dans une nouvelle
arborescence Maven. Les noms publics correspondent aux imports PureScript ;
les classes `__M$…` sont produites par le backend. Garder les helpers privés
près de leur fragment. Une classe privée avec des champs nommés peut clarifier
un état interne sans modifier cette interface.

## Choisir l'implémentation Java

Les commandes `spago install` des sections amont choisissent le package du
registre. Pour employer sa FFI Java, l'application doit sélectionner le checkout
local dans `workspace.extraPackages`, ainsi que les ports nécessaires à ses
dépendances transitives. Exemple à adapter au layout de l'application :

```yaml
workspace:
  extraPackages:
    arrays:
      path: "../javapurs-arrays"
```

Les configurations des suites décrivent les chemins des checkouts voisins.
[tools/port-configs.mjs](../tools/port-configs.mjs) possède la liste commune ;
les dépendances propres à un port restent dans sa configuration. Depuis le
compilateur, `node tools/port-configs.mjs --check` vérifie la cohérence, et
`--write` réécrit seulement le bloc de chemins locaux reconnu.

Le [rapport FFI](ffi-runtime.md#relevé-de-la-génération) dans le manifeste
Java indique le fragment réellement sélectionné. Vérifier ce rapport avant
de conclure qu'une copie est inutile ou de modifier une dépendance.

## Vérifier une modification

Sélectionner le fork TAST et un JDK complet selon le [guide de démarrage](start-here.md).
Le backend voisin doit être construit. Depuis un port standard :

```sh
./bin/test --help
./bin/test
```

Le runner copie les sources et tests dans un workspace temporaire, puis exécute
Spago, Javapurs, `javac --release 17` par défaut et la JVM. Les sources Java du
port sont relues à chaque exécution : leur modification seule ne demande pas
de reconstruire le compilateur. Les workspaces en échec et leurs logs sont
conservés ; les chemins sont affichés. `--clean` reconstruit aussi le backend.
Les noms de dossiers `js-promise` et `js-promise-aff` sont acceptés par le
runner, comme les noms historiques de profils `promise` et `promise-aff`.

Pour Aff, les références, les exceptions et les promesses, les cinq commandes
`bin/test-runtime` donnent accès aux [tests de protocoles](testing.md#runtimes-ffi-et-interopérabilité).
Les autres auxiliaires indiquent leur mode de validation dans leur README.
Une suite passante couvre les cas exécutés ; consulter la matrice pour les API
partielles, notamment la découverte dynamique et les processus enfants.

Après un changement d'organisation ou de configuration, depuis le compilateur :

```sh
node tools/check-port-configs.mjs
node tools/port-configs.mjs --check
node tools/check-port-ffi.mjs
node tools/check-docs.mjs
```

## Garder les contrats lisibles

- Nommer l'état interne selon son rôle : événement, élément en attente, position
  de lecture, segment de buffer ; éviter les indices de tuples implicites.
- Extraire les opérations répétées avec leurs paramètres explicites, en gardant
  l'ordre des effets, les verrous et les appels de callbacks.
- Fermer les ressources Java au niveau qui les crée ; une ressource conservée
  dans un objet doit avoir un propriétaire et une fin de vie identifiables.
- Conserver la représentation des valeurs, les conventions d'appel et les
  exceptions décrites dans les [contrats runtime](ffi-runtime.md).
- Mesurer un défaut avec une petite reproduction avant de le corriger. Pour
  une simple réorganisation, comparer les résultats avant et après sur les
  mêmes entrées, puis exécuter la suite concernée.

Les fonctionnalités manquantes sont décrites dans la matrice et les README.
Les sauvegardes, captures et scripts d'exploration temporaires restent hors des
arbres `src/` et `test/` maintenus.
