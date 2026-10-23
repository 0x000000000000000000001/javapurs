> Archive du TODO à l'ouverture du [plan v5](plan-v5.md), le 21 octobre 2026.
> Le plan v4 est clôturé à 100/100.

# Javapurs — plan v4 : consolidation et lisibilité

Plan v4 — dernière mise à jour : **21 octobre 2026**.

Objectif : réduire la dette de compréhension du compilateur, du runtime Java,
du harnais de tests et des ports, **sans changement de comportement**. Le code
doit rester vérifiable par des humains : un module doit avoir une
responsabilité identifiable, les cas spéciaux doivent être nommés, et les
raccourcis historiques doivent être supprimés ou documentés.

Le [plan v3](plan-v3.md) est clôturé : M20–M32 sont archivés avec leurs
preuves, dont Spec **70/70** et le port `node-child-process`. Les plans v1 et
v2 restent dans [plan v2](plan-v2.md).

Ce TODO est suivi à la racine du compilateur. Les chemins sont relatifs au
workspace parent : `javapurs/` désigne ce dépôt, les ports sont les dossiers
`javapurs-*` voisins.

## Avancement

**100 / 100 points validés — 100 % — 5 lots terminés sur 5.**

### État de départ vérifié

- Spec complet : **70 checks** (62 purs + 8 intégrations) et cinq sondes.
- `test/child-process.mjs` : spawn, stdout, code de sortie et rejeu d’`exit`.
- `node --test test/test-tools.mjs` : **27/27**.
- `node tools/check-docs.mjs` : **684 liens/ancres**, **30 suites**.
- Tous les protocoles du runner sont traités ; aucune sélection rejetée.
- Les changements M32 doivent être committés avant d’ouvrir M41.

## Règles du plan

- **Pas de nouvelle fonctionnalité** : un lot nettoie, nomme, documente ou
  supprime ; il ne change pas la sémantique observable.
- **Pas de gros refactor sans preuve** : chaque déplacement ou simplification
  est couvert par les suites ciblées existantes, ou ajoute un test de
  non-régression ciblé.
- **Un lot = un sujet** : pas de mélange entre compilateur, ports et docs dans
  un même commit lorsque cela peut être évité.
- **Validation ciblée** : pas de `t -c`, de corpus complet ni de `modtest`
  pendant les lots. Les commandes de clôture sont listées ci-dessous.
- **Documentation vivante** : un changement de contrat met à jour le guide
  concerné et `docs/testing.md` ; les preuves historiques restent datées dans
  l’archive.
- **Lisibilité mesurable** : module documenté, noms explicites, cas spéciaux
  nommés, erreurs actionnables, pas de `TODO` orphelin.

## Lots

- [x] **M41 — 10 points — Baseline, cartographie et garde-fous.**
  - Cartographier le pipeline compilateur → TAST → PBO → Java, les points
    d’entrée des tests, les profils de ports et les sorties générées.
  - Produire `docs/code-map.md` : rôle de chaque module, flux de données,
    propriétaires des artefacts et commandes ciblées.
  - Mesurer la dette : fichiers > 250 lignes, duplications de launchers/FFI,
    `TODO`/`FIXME`, cas spéciaux du harnais, liens et anchors documentaires.
  - Établir une baseline reproductible des suites ciblées et conserver les logs
    dans le dossier de preuves du plan.
  - **Clôture — 21 octobre 2026 :** `docs/code-map.md` couvre le pipeline, les
    modules, le harnais, les ports et les artefacts. La baseline relève
    5 355 lignes PureScript, 139 fichiers Java FFI (8 643 lignes), 49 ports,
    30 suites, 3 marqueurs `TODO` et les validations M32 70/70 + 27/27. Dix
    points de friction sont priorisés vers M42–M45. Aucun code exécutable n’a
    été modifié. Voir [Validation M41](testing.md#validation-m01).

- [x] **M42 — 25 points — Compilateur : expliciter les cas spéciaux.**
  - Supprimer le marqueur `null /* TODO: PrimUndefined */` et le test de chaîne
    associé dans `Javapurs.Raw` ; représenter le cas par un nœud ou un sentinel
    Java nommé, avec sa règle de sérialisation documentée.
  - Passer en revue `CodeGen/Expr`, `Chunk`, `Ownership/Workers` et
    `Printer/Body` : responsabilité de module, noms locaux, helpers extraits,
    commentaires de flux et cas limites.
  - Supprimer les branches mortes et les helpers dupliqués identifiés en M41,
    sans modifier les décisions d’optimisation ni le format de sortie.
  - Ajouter ou renforcer les tests ciblés des représentations concernées
    (`undefined`, records, tableaux, sorties Java).
  - **Clôture — 21 octobre 2026 :** `JavaUndefined` est un nœud structurel de
    `JavaAst` (rendu `null`), utilisé par `PrimUndefined`. `Raw` ne reconnaît
    plus de commentaire `TODO` et n’importe plus `Maybe` inutilement. Les
    responsabilités de `CodeGen.Expr`, `Printer.Body`, `Chunk` et
    `Ownership.Workers` sont documentées. Plus aucun `TODO`/`FIXME` dans
    `src`, `test` ou `tools`. Tests ciblés : `ast-scopes`, `representations`,
    `codegen`, `driver` et `typed-records` verts. Voir
    [Validation M42](testing.md#validation-m02).

- [x] **M43 — 20 points — Runtime et FFI : contrats communs.**
  - Inventorier les conventions Java partagées : `undefined`/`Nullable`,
    Buffers, événements, streams, erreurs et fermeture des ressources.
  - Regrouper les helpers répétés ou documenter pourquoi un port doit rester
    autonome ; supprimer les stubs silencieux au profit d’erreurs explicites
    indiquant le port et l’API non supportée.
  - Uniformiser les noms et la documentation des surfaces FFI réellement
    implémentées, y compris les limites `spawn`/`stdio`/IPC.
  - Ajouter un test de non-régression ciblé par helper partagé déplacé.
  - **Clôture — 21 octobre 2026 :** `docs/ffi-runtime.md` documente les
    contrats partagés (absence, Buffers, événements, streams, FS async,
    Net/HTTP, ChildProcess) et justifie des helpers locaux aux ports lorsque
    l’ABI `__M$...` l’impose. Les stubs `node-child-process` nomment l’API et
    lèvent une `UnsupportedOperationException` contextualisée ; `spawnFile` et
    `spawnArgs` sont réels. EventEmitter, Streams, FS, Net, HTTP et Child sont
    verts. Voir [Validation M43](testing.md#validation-m03).

- [x] **M44 — 25 points — Harnais de tests compréhensible.**
  - Découper `test/test-tools.mjs` par responsabilité (fixtures, assertions,
    inventaire) et rendre `tools/port-test-runner.mjs` piloté par données.
  - Réduire les cas spéciaux `Spec`, `SpecOnly`, `SpecFull` et les branches de
    mock à un seul registre de profils, avec un nom et une raison par variante.
  - Isoler la préparation de l’intégration Spec (spago local, timeout, reprise
    sur sortie vide) dans un module lisible et documenté.
  - Rendre les logs d’échec actionnables : phase, commande, cwd, code, extrait
    de sortie et chemin du workspace conservé.
  - **Clôture — 21 octobre 2026 :** `tools/port-profiles.mjs` sépare les données
    de profils du runner et introduit `assertion` (`spec`/`ok`) à la place des
    listes de wrappers. `test/test-tools.mjs` (551 lignes) délègue la
    construction du sandbox à `test/support/tool-fixtures.mjs` (150 lignes).
    `SpecFull` et les profils Fs/Net/Http sont nommés dans le registre. Même
    couverture : **27 tests**, **70 checks**, cinq sondes. Voir
    [Validation M44](testing.md#validation-m04).

- [x] **M45 — 20 points — Documentation, hygiène et clôture.**
  - Garder une page « démarrer et valider » courte pour les contributeurs ;
    déplacer les récits de validation historiques hors du guide opérationnel,
    en conservant les anchors référencés ou des redirections.
  - Mettre à jour README, `docs/compiler.md`, `docs/maintenance.md` et les liens
    de plans ; aucune référence à un plan actif obsolète.
  - Vérifier les TODO/FIXME restants : chacun doit être supprimé, ou associé à
    un lot, un propriétaire et une condition de clôture.
  - Exécuter la clôture complète ciblée et consigner les preuves datées dans le
    registre.
  - **Clôture — 21 octobre 2026 :** [Démarrer et valider](start-here.md)
    est la page courte de reprise. Les récits M01–M32 sont déplacés dans
    [l’historique](validation-history.md), avec les ancres
    `testing.md#validation-mXX` conservées ; les lots v4 sont renumérotés
    M41–M45 pour éviter les collisions. README, maintenance, compilateur et
    plans sont alignés. Aucun `TODO`/`FIXME` dans le code. Validation finale :
    27 tests, Spec 70/70, child-process, `check-docs` et diffs verts. Voir
    [Validation M45](testing.md#validation-m45).

## Ordre et dépendances

1. **M41** fournit la carte et les métriques ; aucun lot ne commence sans lui.
2. **M42** traite le compilateur, **M43** les contrats runtime/FFI.
3. **M44** simplifie le harnais après stabilisation des sorties et des profils.
4. **M45** ferme les docs et la validation ; il ne masque pas un lot incomplet.

Les points mesurent des livrables validés, pas des heures passées. Un lot peut
être découpé en commits, mais sa case ne passe à `[x]` qu’après la validation
ciblée et la note de clôture datée.

## Validation de clôture

Commandes de référence, à adapter au lot :

```sh
../javapurs-spec/bin/test
node test/child-process.mjs
node --test test/test-tools.mjs
node tools/check-docs.mjs
git diff --check
```

Pour un port ou un profil modifié, exécuter sa suite ciblée (`bin/test`) et
conserver les logs. Ne pas lancer de corpus complet pour « vérifier » un
cleanup.

Chaque clôture ajoute une section `Validation Mxx` dans
[docs/testing.md](testing.md) avec la date, les commandes, les résultats,
les limites et les chemins de preuve. Les validations du plan v3 restent
accessibles via [docs/plan-v3.md](plan-v3.md).

## Baseline M41 — 21 octobre 2026

Mesures statiques, reproductibles avec `wc`, `find` et `grep` :

| Mesure | Valeur |
| --- | ---: |
| Lignes PureScript du compilateur (`src/**/*.purs`) | 5 355 |
| Fichiers Java FFI de ports (`javapurs-*/src/**/*.java`) | 139 |
| Lignes Java FFI de ports | 8 643 |
| Ports standards avec `src/`, `test/`, `bin/test`, `spago.java.yaml` | 48 (+7 auxiliaires) |
| Suites directes listées par la matrice | 30 |
| `docs/testing.md` | 3 556 lignes |
| `test/test-tools.mjs` + `test/support/tool-fixtures.mjs` | 551 + 150 lignes après M44 (677 à l’ouverture) |
| `TODO`/`FIXME`/`HACK`/`XXX` dans `src`, `test`, `tools` | 0 après M42 (3 à l’ouverture) |

Les validations de départ restent celles de M32 : Spec **70/70**, cinq sondes,
`test/child-process.mjs` réussi, `test-tools` **27/27**, Node FS vert et
`check-docs` **684 liens** au moment de l’ouverture. Les logs de référence sont
`spec-final-clean.log`, `test-tools-m32-final.log`, `child-final.log` et
`fs-m32-final.log` dans le dossier de preuves M32.

## Dette priorisée pour le plan v4

| Priorité | Point de friction | Preuve | Lot |
| ---: | --- | --- | --- |
| 1 | **Résolu M42** : `PrimUndefined` est un nœud `JavaUndefined` ; `Raw` ne reconnaît plus de commentaire. | `JavaAst`, `Printer`, `CodeGen/Expr`, `Raw`, `test/ast-scopes.mjs` | M42 |
| 2 | Les deux plus gros modules ont été revus et documentés en M42 ; leur découpage n’est pas nécessaire sans preuve de duplication. | `Chunk.purs` 386 lignes, `CodeGen/Expr.purs` 367 | M42 |
| 3 | **Séparé M44** : fixtures dans `test/support/tool-fixtures.mjs`, assertions et inventaire dans `test/test-tools.mjs`. | 551 + 150 lignes | M44 |
| 4 | **Centralisé M44** : profils et `assertion` sont des données dans `tools/port-profiles.mjs` ; le runner ne liste plus les wrappers. | `tools/port-profiles.mjs` | M44 |
| 5 | Les 49 launchers de ports répètent la même séquence de build et de publication. | 49 `bin/test` | M44 |
| 6 | Les 49 `spago.java.yaml` répètent les dépendances et chemins locaux. | 49 fichiers de configuration | M43 |
| 7 | **Contracts documentés M43** : les helpers restent locaux aux ports, car leur ABI `__M$...` est générée par module ; les conventions Nullable, Buffer, événements, streams et erreurs sont centralisées dans `docs/ffi-runtime.md`. | 139 fichiers, 8 643 lignes | M43 |
| 8 | **Corrigé M43** : les stubs `node-child-process` nomment l’API et lèvent `UnsupportedOperationException("node-child-process: …")` ; `spawnFile`/`spawnArgs` sont réels. | `node-child-process` | M43 |
| 9 | `docs/testing.md` mélange guide opérationnel et récits de validation historiques. | 3 556 lignes | M45 |
| 10 | Les fixtures de capacités dupliquent encore des boucles et des helpers de test. | `test/*.mjs`, `test/support/` | M44 |
