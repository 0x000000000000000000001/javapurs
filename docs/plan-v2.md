# Javapurs — plan v2 clôturé et compléments M17–M19

Plan v2 — dernière mise à jour : **5 octobre 2026**.

Archive du TODO à l'ouverture du [plan v3](../../todo.md), le 6 octobre 2026.
Les cases, scores et clôtures ci-dessous conservent leur état historique.

Objectif : rendre les résultats des tests asynchrones fiables, les erreurs de
configuration et de FFI faciles à diagnostiquer, et une première compilation
reproductible depuis un workspace neuf.

Le **plan v1 de maintenabilité est terminé : 100/100, 11 lots M01–M11**.
Ses [preuves datées](testing.md#validation-m11) et ses contrats
restent dans la documentation. La numérotation continue avec M12 pour conserver
des références de validation uniques.

Les chemins de travail cités ci-dessous restent relatifs au workspace contenant
le [TODO actif](../../todo.md) : le compilateur est dans `javapurs/`, les ports
dans les dossiers `javapurs-*` voisins.

## Avancement

**100 / 100 points validés — 100 % — 5 lots terminés sur 5.**

**Plan v2 terminé : M12–M16 sont clôturés.** Les recettes ciblées, références et
limites de couverture restent dans le registre de validation.

**Compléments M17–M19 terminés :** chargement TAST strict, entrée JVM sans faux
succès et contrat FFI des exceptions, hors score du plan v2. Les autres points
de suite restent dans le guide de maintenance.

## Règles de suivi et de validation

- Les cinq cases M12–M16 déterminent le score de ce plan. Les points mesurent les
  livrables validés ; ils ne constituent pas une estimation de durée.
- Chaque lot part d'un constat vérifié ci-dessous. Le réaliser en petites passes
  révisables ; le cocher après son critère de fin, les contrôles pertinents et la
  mise à jour du [registre de validation](testing.md#consigner-une-validation).
- À chaque clôture : noter fichiers, références des sources, commandes, résultats
  et limites ; actualiser date, score et prochaine étape.
- **Validation ciblée uniquement :** reconstruire les composants modifiés et
  exécuter leurs contrôles. Pas de `t -c`, de corpus entier ni de `modtest`.
- Conserver les acquis Java : chunking/BigFunction, appels directs, conventions
  d'appel et compatibilité applicative. Les références b8x restent datées dans le
  registre ; choisir les fixtures concernées par chaque changement.
- Pour une modification de génération, comparer inventaire et octets Java sur
  les mêmes TAST, options et FFI, puis expliquer les différences attendues.
- Terminer par `node tools/check-docs.mjs` depuis `javapurs/` et une revue du diff.
  Le vérificateur recalcule le score et contrôle les preuves des lots cochés.

## Lots, dans l'ordre de travail

- [x] **M12 — 20 points — Suites asynchrones avec résultat de processus fiable.**
  - **Constat :** les anciens runners Aff et Promise/Aff peuvent quitter avec 0
    avant leurs fibres daemon. Les timers des anciens tests Promise renvoient
    des valeurs déjà réglées et certaines Promises enfants restent inobservées.
    Voir le [relevé M10](testing.md#runtimes-ffi-et-interopérabilité).
  - Points d'entrée : `javapurs-{aff,js-promise,js-promise-aff}/bin/test`, leurs
    `test/`, et le support de `javapurs/test/ffi-ports.mjs`.
  - Faire attendre les entrypoints jusqu'à la fin des assertions et nettoyages,
    avec timeout borné et propagation des erreurs au code de sortie JVM.
  - Utiliser de vrais états pending dans les tests Promise ; observer les rejets
    et les résultats de toutes les branches testées.
  - Préparer les suites dans des workspaces isolés, avec les ports transitifs
    explicitement sélectionnés et des logs par phase.
  - **Fin :** chaque commande de port annonce le succès après la dernière
    assertion ; échec tardif, rejet et attente bloquée produisent un échec visible.
  - **Validation :** suites des trois ports concernés, sondes d'échec après une
    suspension et de timeout ; `ffi-runtimes.mjs` ou `ffi-ports.mjs` selon les
    protocoles effectivement modifiés.
  - **Clôture — 3 octobre 2026 :** trois launchers isolés avec attente, inventaire
    d'assertions, watchdogs et marqueur final ; tests Aff adaptés aux threads JVM,
    chaîne Promise observée et FFI de test du pont livrées. **65 contrôles de
    suites**, **12 sondes négatives**, cinq rejeux Aff, **17 assertions × 2 modes**
    d'intégration et **11 contrôles d'outillage** réussis. Voir les
    [preuves M12](testing.md#validation-m12).

- [x] **M13 — 25 points — CLI explicite et sorties Java maîtrisées.**
  - **Constat :** `Config.parseArgs` ignore les arguments inconnus et accepte un
    `--main` incomplet. Les chemins sont fixes ; `Emit` exige un dossier existant
    et conserve les fichiers obsolètes, dont un ancien `MainRun.java`.
  - Points d'entrée : `javapurs/src/Javapurs/{Config,Driver,Emit}.purs`,
    `javapurs/bin/javapurs*` et `javapurs/test/driver.mjs`.
  - Fournir une aide utilisable, des chemins d'entrée/sortie configurables et des
    diagnostics pour options, valeurs et entrypoint invalides. Vérifier les
    arguments réellement transmis par Spago avant de resserrer le parsing.
  - Définir le contrat d'une génération avec ou sans launcher, créer le dossier
    de destination et suivre les fichiers produits par une génération réussie.
  - Gérer les anciennes sorties identifiées par cet inventaire, préserver les
    fichiers étrangers et rendre explicite l'état d'une génération interrompue.
  - **Fin :** une invocation a des entrées/sorties identifiables ; une sélection
    invalide échoue clairement ; un module supprimé ou renommé ne laisse pas un
    ancien launcher présenté comme celui de la nouvelle génération.
  - **Validation :** pilote ciblé : aide, erreurs avant écriture, chemins avec
    espaces, invocation Spago, entrée vide, générations successives, renommage,
    fichier étranger conservé et échec d'I/O. Mettre à jour le contrat CLI.
  - **Clôture — 3 octobre 2026 :** CLI stricte et aide, chemins configurables,
    mode bibliothèque, manifeste SHA-256, staging/publication avec retour arrière
    et récupération livrés. **11 variantes, 25 échecs attendus, deux builds Spago,
    86 fichiers Java identiques**, **9 groupes de tests filesystem** et
    **17 assertions × 2 modes** d'intégration réussis. Nettoyage demandé :
    **3 641 fichiers / 80,9 Mo** archivés, vérifiés puis retirés. Voir les
    [preuves M13](testing.md#validation-m13).

- [x] **M14 — 20 points — FFI sélectionnée et manquante observable.**
  - **Constat :** une FFI absente ou vide produit des stubs qui échouent à l'appel.
    M10 a rencontré un port transitif `foreign` pris dans le registre au lieu du
    port Java. Un fragment non vide est inséré tel quel et ne prouve pas sa
    couverture. Voir le [contrat de résolution](ffi-runtime.md#résolution-et-insertion).
  - Points d'entrée : `javapurs/src/Javapurs/Ffi.purs`, `Driver`, `Emit`, le
    résolveur PBO et les fixtures `driver.mjs`/`ffi-ports.mjs`.
  - Produire un relevé exploitable des modules et bindings foreign, du fragment
    Java effectivement choisi et des cas absents/vides ; afficher les chemins et
    origines nécessaires pour corriger une sélection de dépendance.
  - Faire identifier le binding appelé dans les erreurs de stub, y compris sur
    le chemin curryfié. Distinguer fichier fourni et binding vérifié par une
    compilation/exécution ciblée.
  - Documenter la couverture exécutée et les dépendances transitives des quatre
    ports M10 : Aff, Refs, Promise et Promise/Aff.
  - **Fin :** un mainteneur peut expliquer quelle FFI a été retenue, repérer une
    absence et relier chaque affirmation de couverture à une fixture nommée.
  - **Validation :** FFI adjacente prioritaire, port local/registre, absence,
    fichier vide, binding manquant dans un fragment fourni, erreur de lecture et
    pont Promise/Aff réel ; suites limitées à ces chemins.
  - **Clôture — 5 octobre 2026 :** relevé FFI versionné dans le manifeste de la
    génération (chemins/origines, fragments, SHA-256, bindings, couverture non
    vérifiée) et stubs nommant `Module.binding` livrés. **Huit rapports de modules,
    huit contrôles JVM de stubs, trois sélections, deux échecs `javac` et un échec
    de lecture attendus** validés ; **17 assertions × 2 modes** et sélection
    locale/registre réelles réussies. Sur les entrées figées, **64 fichiers Java
    identiques et 22 écarts limités aux stubs** ; **9 groupes de transactions**
    vérifient aussi le relevé restauré. Voir les
    [preuves M14](testing.md#validation-m14).

- [x] **M15 — 20 points — Installation source reproductible.**
  - **Constat :** le build dépend de deux chemins locaux dans `spago.yaml` et du
    fork TAST ; le launcher importe un `output/` suivi dans Git. Les instructions
    actuelles donnent le layout mais pas un parcours d'installation vérifié de
    bout en bout depuis un environnement neuf.
  - Points d'entrée : `javapurs/README.md`, `javapurs/spago.yaml`, son lockfile,
    `javapurs/bin/build` et les launchers.
  - Fournir une préparation rejouable avec références compatibles du fork
    PureScript, de PBO et des ports requis ; relever les binaires effectivement
    employés, leurs versions et les métadonnées TAST attendues.
  - Reconstruire le backend et ses dépendances à partir des sources dans un
    workspace isolé ; rendre les prérequis manquants immédiatement localisables.
  - Vérifier le parcours application minimale → TAST → Java → classes → JAR,
    puis son exécution depuis un autre dossier avec les seuls artefacts requis.
  - **Fin :** la procédure documentée produit une application exécutable à partir
    des références annoncées, avec un inventaire clair des sources, dépendances
    et artefacts à transmettre.
  - **Validation :** une installation isolée, le programme minimal du README,
    un exemple avec FFI transitive et des sondes ciblées de prérequis absents ou
    de TAST incompatible ; consigner les versions et commandes exactes.
  - **Clôture — 5 octobre 2026 :** manifeste de sept références, installateur
    source, inventaire des binaires/empreintes et sonde TAST livrés. **Deux
    installations neuves réussies**, fork GHC et **459 modules PureScript**
    reconstruits ; Hello et Refs exécutés en classes et JAR autonomes. **Six
    groupes / 29 échecs attendus**, pilote **11 variantes / 25 échecs attendus**,
    et **86 fichiers Java identiques** avec le backend reconstruit. Voir les
    [preuves M15](testing.md#validation-m15).

- [x] **M16 — 15 points — Compatibilité JDK mesurée et cible cohérente.**
  - **Constat :** les validations locales ont utilisé le JDK 26.0.2. Plusieurs
    suites ciblent `--release 17`, tandis que le runner de fixtures utilise la
    cible par défaut de son JDK. Compiler en release 17 ne valide pas à lui seul
    l'exécution sur une JVM 17.
  - Points d'entrée : `javapurs/tools/{java-tools,fixture-runner}.mjs`, les
    launchers des ports concernés et la [matrice](testing.md#build-jdk-cible-et-jvm).
  - Définir et appliquer une cible Java commune aux runners retenus, avec une
    configuration explicite et des diagnostics pour les combinaisons invalides.
  - Relever séparément JDK de compilation, cible de bytecode et JVM d'exécution ;
    vérifier au minimum un JDK 17 et un JDK récent explicitement nommé.
  - **Fin :** le README annonce une matrice réellement exécutée et ses limites ;
    les commandes ciblées permettent de reproduire chaque ligne.
  - **Validation :** petite sélection couvrant pilote, représentations, chunking
    avec BigFunction et runtimes FFI sur les JDK retenus ; exécuter aussi sur JVM
    17 les classes produites en release 17 par le JDK récent.
  - **Clôture — 5 octobre 2026 :** cible commune `JAVAPURS_JAVA_RELEASE=17`, JVM
    distincte via `JAVAPURS_JAVA_RUNTIME`, diagnostics et matrice rejouable livrés.
    **Six suites × trois configurations** réussies : Temurin **17.0.20.1+1**,
    Homebrew **26.0.2**, puis compilation 26/exécution 17 ; cible 17 et bytecode
    majeur 61 vérifiés. **19 groupes d'outillage**, diagnostics FFI sur JDK 17,
    suite Promise/Aff **7 assertions + 4 sondes**, et **deux JAR compilés par 26
    exécutés sur 17** validés. Voir les
    [preuves M16](testing.md#validation-m16).

## Lots complémentaires après le plan v2

Ces lots prolongent les travaux sans modifier le score du plan v2 clôturé.

- [x] **M17 — Chargement TAST strict avant publication.**
  - **Constat reproduit :** le lecteur PBO ignore les JSON mal formés et les
    `corefn.json` absents, puis Javapurs publie une génération partielle avec code
    0. Les métadonnées enrichies absentes sont aussi acceptées par défaut.
  - Ajouter une frontière d'entrée Javapurs : lecture/décodage fatals, tableaux
    TAST attendus, doublons de modules et dépendances non-Prim manquantes signalés.
  - Conserver un parsing JSON unique, le décodage et le tri PBO, ainsi que la
    lecture bornée ; un échec précède la préparation des sorties.
  - **Fin :** des entrées invalides nomment le fichier/module concerné, renvoient
    1 et préservent octet pour octet la génération précédente ; les entrées valides
    conservent leur Java sur les références figées.
  - **Validation ciblée :** sondes de fichiers/métadonnées/graphe, pilote sur TAST
    figé, intégration FFI et reconstruction isolée du backend ; registre et docs.
  - **Clôture — 5 octobre 2026 :** frontière `Javapurs.Input`, diagnostics avec
    chemin, importeur/dépendance ou doublon ; dossiers de documentation Prim admis.
    **28 entrées invalides / 112 refus avant préparation**, sorties/manifeste/caches
    préservés ; **86 fichiers Java identiques**, pilote **11 variantes / 25 échecs
    attendus**, intégration FFI **17 assertions × 2 modes**. Reconstruction isolée
    de **460 modules**, lockfile inchangé et suite d'entrée réussie. Voir les
    [preuves M17](testing.md#validation-m17).

- [x] **M18 — Entrée JVM invalide sans faux succès.**
  - **Constat reproduit :** `MainRun` quitte avec code 0 et sans exécution lorsque
    `main` est un entier, `null` ou un objet FFI qui n'est ni `Supplier` ni
    `Function`, malgré une génération et un `javac` réussis.
  - Refuser ces valeurs à l'entrée JVM avec le champ Java concerné et son type
    effectif ; conserver priorité `Supplier`, argument `null` de `Function`,
    appel unique et propagation des exceptions de l'action.
  - **Fin :** codes JVM contrôlés en classes et JAR ; les deux ABI valides restent
    exécutables et une valeur invalide n'est plus présentée comme un succès.
  - **Validation ciblée :** fixtures TAST/FFI réelles, pilote et comparaison Java
    sur entrées figées ; écarts limités au contrôle ajouté dans les launchers.
  - **Clôture — 5 octobre 2026 :** diagnostic `IllegalStateException` pour un
    `main` non exécutable, ABI et propagation des erreurs vérifiées. **10 variantes
    en classes et JAR**, **6 succès / 14 échecs JVM attendus** sur chacune des JVM
    **26 et 17**, compilation JDK 26/release 17. Pilote **11 variantes / 25 échecs
    attendus** réussi ; **76 Java identiques / 10 launchers modifiés seulement par
    le contrôle ajouté**, sur TAST figés. Voir les
    [preuves M18](testing.md#validation-m18).

- [x] **M19 — Exceptions FFI cohérentes et identité conservée.**
  - **Constat reproduit :** `errorWithCause` porte le nom `RuntimeException`, les
    traces ignorent le nom personnalisé et `throwException` enveloppe les
    exceptions vérifiées/`java.lang.Error`, changeant leur identité via Aff/Promise.
    Les noms vides et les messages natifs absents ne respectent pas le contrat.
  - Corriger les constructeurs/en-têtes et les replis de propriétés ; relancer
    chaque `Throwable` sans wrapper en conservant l'ABI curryfiée/Supplier.
  - **Fin :** noms, causes, traces, effets différés et handlers vérifiés ; identité
    conservée via les API PureScript, Aff et Promise, en classes et JAR autonomes.
  - **Validation ciblée :** groupe Exceptions des vrais fragments, référence JS,
    intégration dans les deux modes de records, JVM 17/26 et comparaison Java figée.
  - **Clôture — 5 octobre 2026 :** **13 contrôles Exceptions**, intégrés aux
    **49 contrôles directs** réussis sur JDK/JVM 26 ; groupe Exceptions réussi
    aussi avec JDK/JVM 17. **25 assertions × 2 modes × classes/JAR × JVM 26/17**,
    soit **200 assertions d'intégration** ; sélections FFI locale/registre vérifiées.
    Sur **275 TAST figés**, **422 Java identiques / 1 écart limité au fragment
    Exceptions** ; **52 sources du backend identiques**. Voir les
    [preuves M19](testing.md#validation-m19).

## Entretien demandé après M18

**5 octobre 2026 — nettoyage terminé dans les 55 dossiers Javapurs.**
**177 301 fichiers / 2,96 Go** retirés après archivage et vérification, dont
**13 738 fichiers suivis** : sorties de ports, caches, trois `output.bak`,
temporaires filesystem, Finder, classe isolée et sauvegarde Java. Règles Git
complétées, sources et build exécutable préservés ; launcher et intégration FFI
**17 assertions × 2 modes** validés. Voir le
[registre](testing.md#nettoyage-demandé-après-m18) et les
[modalités de restauration](maintenance.md#nettoyage-demandé-après-m18).

## Points d'appui

- [Reprise du dépôt et autres points ouverts](maintenance.md).
- [Guide du compilateur](compiler.md) et
  [matrice de validation](testing.md#matrice-des-tests).
- [Contrats FFI et runtimes](ffi-runtime.md).
- [Clôture du plan v1](testing.md#validation-m11).
