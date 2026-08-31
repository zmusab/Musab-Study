# Source des modèles 3D — Anatomie, Tête et Cou

## Origine

Les maillages 3D utilisés dans `public/anatomy/*.glb` proviennent de
**BodyParts3D/Anatomography**, une base de données maintenue par le DBCLS
(Database Center for Life Science, Université de Tokyo) :
http://lifesciencedb.jp/bp3d/

Version utilisée : `3.0` / `20110915`, telle que redistribuée en STL
binaire (conversion depuis les OBJ originaux, sans autre modification
géométrique) par le mirroir GitHub public
https://github.com/Kevin-Mattheus-Moerman/BodyParts3D. Le modèle source
est un unique spécimen masculin — BodyParts3D ne fournit pas de variante
féminine à ce jour, d'où l'absence d'un sélecteur homme/femme fonctionnel
dans cette version de Musab Study (voir plus bas).

## Licence

**Creative Commons Attribution-Share Alike 2.1 Japan (CC BY-SA 2.1 JP)**
http://lifesciencedb.jp/bp3d/info_en/license/index.html

Attribution requise :
> BodyParts3D, (c) The Database Center for Life Science licensed under
> CC Attribution-Share Alike 2.1 Japan.

Citation académique de référence :
> Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K.
> BodyParts3D: 3D structure database for anatomical concepts.
> Nucleic Acids Res. 2009 Jan;37(Database issue):D782-5.
> https://doi.org/10.1093/nar/gkn613

Tout usage de ces fichiers en dehors de Musab Study doit respecter la
clause « Share Alike » : toute redistribution de ces données (ou d'un
dérivé direct) doit rester sous une licence compatible CC BY-SA.

## Conversion effectuée dans ce projet

1. Clonage en lecture seule du mirroir STL (`assets/BodyParts3D_data/`).
2. Sélection d'un sous-ensemble Tête-et-Cou (88 structures, cf.
   `headNeckCatalog.json`) parmi les 934 maillages disponibles dans ce
   mirroir, identifié par recoupement du fichier `parts_list_e.txt`
   (nomenclature FMA — Foundational Model of Anatomy) avec les fichiers
   `.stl` réellement présents.
3. Script `scripts/anatomy/convert-headneck.mjs` : parseur STL binaire +
   écrivain glTF/GLB écrits à la main (aucune dépendance de conversion 3D
   externe), un fichier par système anatomique (squelette/muscles/
   vaisseaux/organes), un noeud nommé par structure.
4. Post-traitement avec `@gltf-transform/cli` (Apache-2.0/MIT,
   https://github.com/donmccurdy/glTF-Transform) : soudure des sommets
   dupliqués, simplification géométrique légère (tolérance d'erreur
   0,003 de l'étendue du maillage — priorité à la fidélité de forme sur
   la réduction de triangles), quantification et compression Meshopt.
   `--join false` explicitement pour ne PAS fusionner les structures :
   chaque noeud reste sélectionnable individuellement dans l'application.

## Couverture réelle du sous-ensemble Tête-et-Cou (88 structures)

| Système | Structures avec maillage 3D réel | Structures cataloguées sans maillage (contenu cours/IA seulement) |
|---|---|---|
| 🦴 Squelette | 8 os + 28 dents permanentes (nomenclature FDI) | — |
| 💪 Muscles | 30 (masticateurs, faciaux, sus/sous-hyoïdiens) | — |
| 🩸 Vaisseaux | 4 (carotides communes, jugulaires internes) | artère faciale, artère maxillaire, artère linguale |
| 🫀 Organes | 4 (oreille, globe oculaire, gencives sup./inf.) | langue, glandes parotide/submandibulaire/sublinguale, pharynx |
| 🧠 Nerfs | **0** — aucun maillage nerveux dans ce jeu de données v3.0 | trijumeau, V2, V3, alvéolaire inférieur, lingual, facial |

**Point important** : les structures « sans maillage » existent quand même
comme `AnatomyStructure` réelles (nom, nom latin corrects) — elles restent
recherchables, explicables par l'IA à partir des cours, et permettent de
créer des flashcards. Elles ne sont simplement pas visuellement
sélectionnables dans la scène 3D tant qu'aucune source ouverte ne fournit
leur géométrie. Aucune structure n'est inventée ; l'absence de maillage est
un état honnête, pas une approximation silencieuse.

## Ce qui n'est PAS dans ce sous-ensemble

Le reste du corps (tronc, membres) n'a pas été converti pour cette étape —
seule la région Tête et Cou reçoit des structures individuellement
nommées et sélectionnables. Voir le plan de la Phase 1 pour le périmètre
complet.
