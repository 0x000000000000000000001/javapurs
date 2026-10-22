# Javapurs — plan v7 : vérité documentaire et couverture restante

Plan v7 — dernière mise à jour : **22 octobre 2026**.

Objectif : supprimer les dernières ambiguïtés entre l’état réel du dépôt et sa
documentation, finir la migration des fixtures Java, centraliser les commandes
de contrôle et publier une matrice FFI des ports. Aucun changement de
comportement du compilateur ou des ports n’est attendu.

Le [plan v6](docs/plan-v6.md) est clôturé à **100/100**. Les plans v5, v4 et v3
restent dans [plan v5](docs/plan-v5.md), [plan v4](docs/plan-v4.md) et
[plan v3](docs/plan-v3.md).

## Avancement

**100 / 100 points validés — 100 % — 5 lots terminés sur 5.**

### Constats mesurés à l’ouverture

- **48** launchers standards, **49** configurations Spago canoniques,
  **1 028** sorties JS/source maps stables après double build.
- Spec complet **70/70**, `test-tools` **27/27**, 30 scripts directs.
- Plusieurs affirmations sont devenues historiques : README pointe encore
  certains plans vers `todo.md`, `testing.md` parle de « six protocoles non
  pris en charge » et `port-launchers.md` conserve des statuts « Spec exclue ».
- `codegen`, `chunk`, `ast-scopes`, `constructor-reuse`, `counted-loops`,
  `loop-invariants` et `typed-records` utilisent `java-fixture` ; les suites
  `direct-calls`, `printer`, `ownership-loops` et `representations` gardent
  encore leur propre cycle Java.
- Les commandes de contrôle sont dispersées entre `check-docs`,
  `check-port-configs`, `port-configs`, `check-generated` et les suites.
- Aucun inventaire unique ne relie les 48 ports à leur surface FFI réellement
  supportée et à leurs limites.

## Règles du plan

- **Documentation factuelle** : une phrase de statut doit correspondre à une
  preuve ou à une commande exécutable.
- **Pas de nouvelle fonctionnalité** : ce plan nettoie, migre ou documente.
- **Préserver les contrats** : 30 scripts, 27 tests d’outillage, Spec 70/70.
- **Validation ciblée** : les contrôles rapides restent rapides ; les suites
  réelles sont exécutées pour les ports effectivement touchés.
- **Un lot = un sujet** ; docs, fixtures et FFI ne sont pas mélangés.

## Lots

- [x] **M71 — 20 points — Vérité documentaire.**
  - Corriger les liens de plans dans README (`v4`, `v5`, `v6`) et les mentions
    « Spec exclue » / « six protocoles » / « `npx` hors JVM » qui ne décrivent
    plus l’état réel.
  - Distinguer dans `port-launchers.md` l’inventaire historique M23 de la
    matrice actuelle des 48 ports validés.
  - Aligner `testing.md`, `maintenance.md` et `start-here` sur les commandes et
    résultats v6.
  - **Clôture — 22 octobre 2026 :** les liens de plans v4–v7, le statut Spec
    **70/70** et l’absence de protocoles rejetés sont alignés dans README,
    `testing.md` et `port-launchers.md`. L’inventaire M23 reste explicitement
    historique ; les 48 profils actuels et 7 auxiliaires sont décrits à part.
    `check-docs` est vert. Voir [Validation M71](docs/testing.md#validation-m71).

- [x] **M72 — 25 points — Fixtures Java restantes.**
  - Étendre `java-fixture` si nécessaire pour les variantes compilation seule,
    exécution seule et options de sortie.
  - Migrer `direct-calls`, `printer`, `ownership-loops` et `representations`
    vers le cycle commun.
  - Conserver les helpers métier et les assertions dans leurs suites ; ne
    déplacer que la préparation Java.
  - **Clôture — 22 octobre 2026 :** `java-fixture` accepte les arguments de
    programme. `direct-calls`, `printer`, `ownership-loops` et
    `representations` sont migrés ; leurs 40/86/18/344 contrôles restent verts.
    30 scripts, `test-tools` 27/27 et Spec 70/70. Voir
    [Validation M72](docs/testing.md#validation-m72).

- [x] **M73 — 20 points — Validation unifiée.**
  - Ajouter `tools/check-all.mjs` avec un profil rapide : docs, configurations,
    canonicalisation et hashes de sorties, sans Spec complet.
  - Ajouter un profil `--full` pour Spec, `test-tools` et les ports sélectionnés,
    en conservant des logs par phase.
  - Refuser les options inconnues et ne jamais masquer un échec par un `|| true`.
  - **Clôture — 22 octobre 2026 :** `tools/check-all.mjs` offre `--quick`
    (docs, ports, canonicalisation, sorties) et `--full` (test-tools,
    child-process, Spec, Node FS). Les deux profils passent et écrivent
    `logs/check-all/<phase>.log`. Voir
    [Validation M73](docs/testing.md#validation-m73).

- [x] **M74 — 20 points — Matrice FFI des ports.**
  - Créer `docs/port-ffi.md` : pour chaque port standard, modules FFI, surface
    réellement implémentée, stubs/limites et suite de validation.
  - Vérifier les ports auxiliaires et `node-child-process` ; distinguer
    explicitement « non requis », « supporté » et « non supporté ».
  - Faire vérifier par un test d’outillage que chaque port standard possède une
    ligne et que ses chemins FFI existent.
  - **Clôture — 22 octobre 2026 :** `docs/port-ffi.md` couvre 48 ports
    standards et 7 auxiliaires ; `tools/check-port-ffi.mjs` vérifie **118
    fichiers Java** contre la matrice. `check-all --quick` inclut ce contrôle
    et passe. Voir [Validation M74](docs/testing.md#validation-m74).

- [x] **M75 — 15 points — Clôture.**
  - Mettre à jour README, carte, maintenance, historique et matrices.
  - Consigner les validations M71–M75, vérifier les sorties générées et fermer
    `todo.md` sans workspace temporaire ni artefact inexpliqué.
  - **Clôture — 22 octobre 2026 :** `check-all --full` passe ses 9 phases ;
    documentation, matrice FFI, sorties et configurations sont alignées ;
    aucune case ne reste ouverte. Voir
    [Validation M75](docs/testing.md#validation-m75).

## Ordre et dépendances

1. **M71** remet la documentation en accord avec l’état réel.
2. **M72** termine la mécanique de fixtures.
3. **M73** agrège les contrôles rapides et complets.
4. **M74** publie la matrice FFI et la fait vérifier.
5. **M75** clôt les preuves et la documentation.

## Validation de clôture

```sh
node --test test/test-tools.mjs
node test/child-process.mjs
../javapurs-spec/bin/test
node tools/check-port-configs.mjs
node tools/port-configs.mjs --check
node tools/check-generated.mjs
node tools/check-docs.mjs
node tools/check-all.mjs
git diff --check
```

Chaque lot ajoute une section `Validation M7x` dans
[docs/testing.md](docs/testing.md). Les récits v1–v6 restent dans
[l’historique](docs/validation-history.md).
