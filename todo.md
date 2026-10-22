# Javapurs — plan v6 : frontières restantes et reproductibilité

Plan v6 — dernière mise à jour : **21 octobre 2026**.

Objectif : terminer les derniers points de maintenance structurelle laissés par
le plan v5. Les launchers, les stubs FFI et le harnais de test sont désormais
stables ; le travail restant est concentré sur un gros module du compilateur,
la source unique des configurations Spago, les fixtures encore répétitives et
le statut explicite des ports auxiliaires.

Le [plan v5](docs/plan-v5.md) est clôturé à **100/100**. Les plans antérieurs
restent dans [plan v4](docs/plan-v4.md), [plan v3](docs/plan-v3.md) et
[l’historique des validations](docs/validation-history.md).

## Avancement

**100 / 100 points validés — 100 % — 5 lots terminés sur 5.**

### Constats mesurés à l’ouverture

- `Javapurs.CodeGen.Expr` fait **371 lignes** et concentre calls, fonctions,
  effets, branches, boucles et littéraux.
- **49** `javapurs-*/spago.java.yaml` restent des fichiers explicites ; le
  contrôle M51 valide leurs 2 376 chemins, mais leur bloc `extraPackages` est
  répété presque à l’identique.
- **48** launchers standards sont génériques ; **7** ports restent auxiliaires,
  dont `node-child-process`, sans `bin/test` ni `spago.java.yaml`.
- `test/support/java-fixture.mjs` couvre déjà `counted-loops`,
  `loop-invariants` et `typed-records` ; plusieurs autres suites répètent encore
  la même préparation.
- Les sorties compilateur suivies sont stables après double build, mais la
  procédure de contrôle n’est pas encore automatisée.
- Validations de départ : Spec **70/70**, `test-tools` **27/27**,
  `check-port-configs` vert, `check-docs` vert.

## Règles du plan

- **Pas de nouvelle fonctionnalité** : uniquement des frontières, de la
  génération contrôlée, des fixtures et de la documentation.
- **Préserver les ABI et les sorties Java** : toute extraction de module doit
  passer `chunk`, `codegen`, `driver` et les fixtures concernées.
- **Une source de vérité pour les configurations** : les fichiers générés
  restent lisibles, mais leur bloc commun ne doit plus être corrigé 49 fois.
- **Validation ciblée** : pas de corpus complet. Chaque lot exécute les suites
  touchées, `check-port-configs`, `test-tools`, Spec et `check-docs`.
- **Un lot = un sujet** ; les ports et le compilateur ne sont pas mélangés.

## Lots

- [x] **M61 — 25 points — Frontières de `CodeGen.Expr`.**
  - Extraire une frontière `CodeGen.Calls` pour les appels, workers, cibles de
    queue et arités boxed, en conservant les types `CodegenEnv`/`Translation`.
  - Réduire `CodeGen.Expr` sous **300 lignes** sans déplacer les décisions de
    représentation ou d’effet.
  - Ajouter un test ciblé sur l’extraction ; conserver `codegen`, `driver`,
    `typed-records` et les sorties Java.
  - **Clôture — 21 octobre 2026 :** `CodeGen.Helpers` isole les cibles de
    queue, l’arité boxed, les locaux/globaux, les littéraux, les accesseurs et
    l’assemblage des branches. `CodeGen.Expr` passe de **371 à 279 lignes**.
    `chunk` 15, `codegen` 48/48, `driver` et `typed-records` 75 sont verts.
    Voir [Validation M61](docs/testing.md#validation-m61).

- [x] **M62 — 25 points — Source unique des configurations Spago.**
  - Définir une table centrale des packages locaux (`javapurs-*`, PBO, fork)
    et un outil `tools/port-configs.mjs` pour produire ou vérifier les blocs
    `extraPackages`.
  - Conserver les dépendances et options propres à chaque port ; ne générer que
    le bloc commun et les chemins locaux.
  - Ajouter une vérification d’idempotence et un mode `--check` sans écriture.
  - **Clôture — 21 octobre 2026 :** `tools/port-configs.mjs` définit les 48
    packages locaux communs et les extras `js-bigints`/`node-child-process`.
    `--check` est idempotent ; `--write` n’a réordonné que Spec et Yoga.
    `check-port-configs` valide 49 configurations et 2 376 chemins ; Spec 70/70
    et Yoga 52/52 sont verts. Voir [Validation M62](docs/testing.md#validation-m62).

- [x] **M63 — 25 points — Fixtures restantes.**
  - Étendre `test/support/java-fixture.mjs` pour les variantes compilation
    seule/exécution seule et les options de sortie.
  - Migrer au moins quatre suites encore répétitives (`ast-scopes`, `chunk`,
    `codegen`, `constructor-reuse` ou `direct-calls`).
  - Conserver le nombre de scripts (**30**), `test-tools` **27/27** et Spec
    **70/70** ; ne fusionner que les helpers au contrat identique.
  - **Clôture — 21 octobre 2026 :** `java-fixture` gère aussi les classes de
    sortie et le classpath. `ast-scopes`, `chunk`, `codegen` et
    `constructor-reuse` sont migrés ; leurs 110/15/48/7 contrôles restent verts.
    `test-tools` 27/27 et Spec 70/70. Voir
    [Validation M63](docs/testing.md#validation-m63).

- [x] **M64 — 15 points — Ports auxiliaires et sorties.**
  - Formaliser le statut des 7 ports auxiliaires dans la carte et les README ;
    ajouter une configuration `spago.java.yaml` à `node-child-process` ou
    justifier explicitement son absence.
  - Ajouter `tools/check-generated.mjs` : vérifier les hashes des sorties
    compilateur après un build, sans lancer de suite fonctionnelle.
  - Documenter la commande de double build et son résultat attendu.
  - **Clôture — 22 octobre 2026 :** le statut des 7 ports auxiliaires est
    tabulé dans `docs/port-launchers.md`, dont `node-child-process` (test
    compilateur, pas de suite Spago) et `spec-discovery` (configuration seule).
    `tools/check-generated.mjs` compare les hashes de **1 028 fichiers**
    JS/source maps avant/après un build ; ils sont stables. Voir
    [Validation M64](docs/testing.md#validation-m64).

- [x] **M65 — 10 points — Documentation et clôture.**
  - Mettre à jour carte, start-here, maintenance, README et matrice des tests.
  - Archiver le plan v5 (déjà préparé), consigner les validations M61–M65 et
    fermer le plan sans workspace temporaire ni sortie générée non expliquée.
  - **Clôture — 22 octobre 2026 :** documentation et matrice alignées ; plan
    v5 déjà archivé. Validation finale : 27 tests, Spec 70/70, child-process,
    49 configurations canoniques, 2 376 chemins, 1 028 sorties stables et diffs
    propres. Voir [Validation M65](docs/testing.md#validation-m65).

## Ordre et dépendances

1. **M61** stabilise le compilateur et ses sorties.
2. **M62** centralise les configurations sans toucher aux profils.
3. **M63** simplifie les fixtures après stabilisation des commandes.
4. **M64** formalise les auxiliaires et automatise le contrôle des sorties.
5. **M65** clôt la documentation et les preuves.

## Validation de clôture

```sh
node --test test/test-tools.mjs
node test/child-process.mjs
../javapurs-spec/bin/test
node tools/check-port-configs.mjs
node tools/check-generated.mjs
node tools/check-docs.mjs
git diff --check
```

Chaque lot ajoute une section `Validation M6x` dans
[docs/testing.md](docs/testing.md). Les récits v1–v5 restent dans
[l’historique](docs/validation-history.md).
