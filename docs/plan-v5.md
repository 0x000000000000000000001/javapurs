> Archive du TODO à l'ouverture du [plan v6](plan-v6.md), le 21 octobre 2026.
> Le plan v5 est clôturé à 100/100.

# Javapurs — plan v5 : ports, fixtures et frontières

Plan v5 — dernière mise à jour : **21 octobre 2026**.

Objectif : finir le cleanup structurel après le plan v4. Le compilateur, le
harnais et les docs sont désormais lisibles ; les points restants sont
concentrés dans les ports, les configurations Spago, les stubs FFI résiduels et
les fixtures de tests encore répétitives.

Le [plan v4](plan-v4.md) est clôturé à **100/100**. Le plan v3 et les
validations historiques restent dans [plan v3](plan-v3.md) et
[l’historique](validation-history.md).

## Avancement

**100 / 100 points validés — 100 % — 5 lots terminés sur 5.**

### Constats mesurés à l’ouverture

- **48** fichiers `javapurs-*/bin/test`, tous réduits à **4 lignes** et au même
  dispatcher, avec seulement le nom du port qui varie.
- **49** fichiers `javapurs-*/spago.java.yaml`, dont un pour
  `javapurs-spec-discovery` sans launcher.
- **139** fichiers Java FFI dans les ports, **8 653 lignes**.
- **7** dossiers `javapurs-*` sans `bin/test` : `argonaut-core`, `control`,
  `js-bigints`, `js-uri`, `node-child-process`, `spec-discovery`,
  `unsafe-reference`.
- `node-child-process` possède `spago.yaml` mais ni `spago.java.yaml` ni
  `bin/test` ; sa validation vit dans `test/child-process.mjs`.
- Deux ports conservent `null /* TODO: PrimUndefined */` dans
  `src/Partial/Unsafe.java` : `partial` et `strings-extra`.
- Les suites directes réutilisent les templates runtime, mais plusieurs
  fixtures répètent encore la préparation de workspace, `javac`, l’exécution et
  les diagnostics.

Les validations de départ restent : Spec **70/70**, `test-tools` **27/27**,
`check-docs` vert, tous les protocoles traités.

## Règles du plan

- **Pas de nouvelle fonctionnalité** : le plan supprime de la duplication,
  explicite des contrats ou documente une exception.
- **Pas de génération silencieuse** : un launcher, une configuration ou un stub
  doit rester compréhensible et réparable à la main.
- **Validation ciblée** : `test-tools`, Spec, les ports touchés et
  `check-docs`. Pas de corpus complet pour valider un cleanup.
- **Préserver les contrats publics** des ports : noms de modules, options CLI et
  sorties des suites restent compatibles.
- **Un lot = un sujet** ; les changements de ports et de compilateur ne sont pas
  mélangés dans le même commit lorsque c’est évitable.

## Lots

- [x] **M51 — 20 points — Launchers et configurations de ports.**
  - Remplacer les 48 launchers de 4 lignes par un dispatcher générique qui
    déduit le nom du port depuis le dossier (`javapurs-<nom>`).
  - Auditer les 7 ports sans launcher et les 49 configurations Spago :
    décider explicitement `standard`, `auxiliaire` ou `hors runner`.
  - Intégrer `node-child-process` comme port standard, ou documenter pourquoi
    son test compilateur reste séparé.
  - Ajouter un contrôle `tools/check-port-configs.mjs` : nom de package,
    package set, chemins locaux et présence des sources/FFI déclarés.
  - **Clôture — 21 octobre 2026 :** les 48 launchers standards sont un unique
    dispatcher de 5 lignes déduisant le port du dossier. Les 7 ports auxiliaires
    sont classés dans `docs/port-launchers.md` ; `node-child-process` reste
    couvert par `test/child-process.mjs`. `tools/check-port-configs.mjs` valide
    48 profils, 49 configurations, 7 auxiliaires et 2 376 chemins locaux.
    `test-tools` 27/27 ; FS, Net et HTTP verts. Voir
    [Validation M51](testing.md#validation-m51).

- [x] **M52 — 20 points — Dette FFI résiduelle des ports.**
  - Supprimer les deux marqueurs `TODO: PrimUndefined` de `partial` et
    `strings-extra` ; utiliser une constante ou un helper nommé qui conserve
    exactement le `null` Undefined attendu.
  - Auditer les stubs et fallbacks silencieux (`Node.FS.Stats`, retours `null`
    non contractuels) ; soit les documenter, soit les remplacer par une erreur
    explicite nommant le port et l’API.
  - Compléter les README de ports avec la surface réellement supportée et les
    limites connues, sans dupliquer les contrats généraux.
  - **Clôture — 21 octobre 2026 :** les deux `TODO: PrimUndefined` sont
    remplacés par un commentaire explicite du sentinel. `strings-extra` supprime
    **20 shims Java locaux** (dont `Data/Array.java` avec de nombreux
    `FFI_STUB`) et utilise les ports déclarés. `Node.FS.Stats` documente son
    fallback non-POSIX. `partial`, `strings-extra` et `node-fs` sont verts ;
    aucun `FFI_STUB` ni `TODO` ne reste dans les ports. Voir
    [Validation M52](testing.md#validation-m52).

- [x] **M53 — 25 points — Fixtures de tests partagées.**
  - Extraire de `test/support/` un petit module de fixtures pour workspace
    temporaire, écriture de sources, `javac`, exécution JVM et capture de logs.
  - Migrer au moins trois suites directes répétitives (`loop-invariants`,
    `typed-records`, `counted-loops` ou `tco`) vers ce module.
  - Factoriser les helpers de boucle/records uniquement lorsqu’ils ont le même
    contrat sémantique ; conserver les assertions et les cas de refus.
  - **Clôture — 21 octobre 2026 :** `test/support/java-fixture.mjs` centralise
    l’écriture des sources, `javac` et le lancement JVM. `counted-loops`,
    `loop-invariants` et `typed-records` sont migrés ; leurs 51 + 50 + 75
    contrôles restent verts. Aucune fusion de helpers de boucle/records n’a été
    imposée sans contrat commun. `test-tools` 27/27 et Spec 70/70. Voir
    [Validation M53](testing.md#validation-m53).

- [x] **M54 — 20 points — Frontières du compilateur.**
  - Découper `Javapurs.Chunk` et/ou `Javapurs.CodeGen.Expr` uniquement aux
    frontières déjà nommées par leurs commentaires : reconstruction, admission,
    calls, loops, values.
  - Extraire des helpers testables sans changer les décisions d’optimisation
    ni le texte Java produit.
  - Ajouter un test ciblé par frontière extraite ; réutiliser `chunk`,
    `codegen`, `driver` et `typed-records`.
  - **Clôture — 21 octobre 2026 :** `Chunk` est découpé en `Chunk.Types`
    (état/result shapes), `Chunk.Value` (construction des valeurs) et
    `Chunk.Helpers` (groupes de tableaux fermés) ; il passe de 388 à 331 lignes.
    `chunk` (15 fixtures), `codegen` (48/48), `driver` et `typed-records` (75)
    sont verts. Le build complet a aussi régénéré les sorties PBO suivies.
    Voir [Validation M54](testing.md#validation-m54).

- [x] **M55 — 15 points — Reproductibilité, documentation et clôture.**
  - Vérifier que les sorties `output/Javapurs.*` suivies correspondent aux
    sources après build, et documenter la commande de contrôle.
  - Mettre à jour `start-here`, carte du code, maintenance, README et matrice
    des tests avec les nouveaux contrôles de ports.
  - Archiver le plan v4, consigner les preuves M51–M55 et fermer le plan sans
    laisser de workspace temporaire ou de fichier généré non expliqué.
  - **Clôture — 21 octobre 2026 :** un rebuild complet a été exécuté deux fois ;
    les hashes de `output/**/*.js` et `*.js.map` sont identiques. `start-here`,
    carte, maintenance, README et matrice sont à jour. Validation finale :
    `test-tools` 27/27, Spec 70/70, child-process réussi, 48 ports standards
    contrôlés et diffs propres. Voir [Validation M55](testing.md#validation-m55).

## Ordre et dépendances

1. **M51** stabilise les launchers et configurations ; les autres lots peuvent
   ensuite utiliser les mêmes commandes.
2. **M52** traite les contrats FFI sans toucher au runner.
3. **M53** simplifie les fixtures après stabilisation des profils de ports.
4. **M54** découpe le compilateur avec les tests existants.
5. **M55** clôt les docs, les sorties et la validation.

## Validation de clôture

```sh
node --test test/test-tools.mjs
node test/child-process.mjs
../javapurs-spec/bin/test
node tools/check-port-configs.mjs
node tools/check-docs.mjs
git diff --check
```

Chaque lot ajoute une section `Validation M5x` dans
[docs/testing.md](testing.md), avec les ports réellement exécutés et les
limites. Les récits v1–v4 restent dans [l’historique](validation-history.md).
