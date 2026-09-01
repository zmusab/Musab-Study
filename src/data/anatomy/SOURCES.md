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

## Précision du jeu de données — plafond connu

Le DBCLS distribue publiquement **deux paliers de précision** (README
officiel, §2.6-2.7) :

| Fichier | Taux de réduction | Taille |
|---|---|---|
| `BodyParts3D_3.0_obj_95.zip` | 95 % | 521 Mo |
| `BodyParts3D_3.0_obj_99.zip` | 99 % | 127 Mo |

> « A polygon mesh with the reduction rate of 95% is more precise than that
> with 99% because 95% has five times more polygons (triangles) than 99%. »

Le mirroir utilisé ici correspond au palier **95 %**, soit 26,3 M de
triangles sur 934 maillages — **le plus précis publiquement distribué**. La
géométrie non réduite n'est pas diffusée : c'est donc un plafond de qualité,
pas un choix de notre part.

## Conversion effectuée dans ce projet

1. Clonage en lecture seule du mirroir STL (`assets/BodyParts3D_data/`).
2. **`scripts/anatomy/build-catalog.mjs`** génère `headNeckCatalog.json`
   depuis l'**arbre d'inclusion officiel** (`conventional_part_of.txt`, le
   même que l'onglet « Tree » du BP3D Viewer) : descente depuis `head` et
   `neck`, conservation de tout descendant possédant réellement un fichier
   STL. La sélection n'est donc pas une liste écrite à la main. Quelques
   structures pertinentes relevant d'un autre système (carotides,
   jugulaires, nerfs optiques, cartilage thyroïde, trachée, œsophage,
   clavicules…) sont ajoutées via `EXTRA_IDS`, chacune vérifiée
   individuellement.
3. Les noms français et latins viennent de **`scripts/anatomy/naming.mjs`**,
   seule couche non lue directement dans la source (BodyParts3D ne fournit
   qu'un libellé anglais). Le nom latin n'est renseigné que lorsqu'il est
   certain — sinon `null`, et l'interface n'affiche alors aucun latin plutôt
   qu'une approximation. Toute structure présente dans les données mais
   absente du dictionnaire **fait échouer la génération**.
4. **`scripts/anatomy/convert-headneck.mjs`** : parseur STL binaire +
   écrivain glTF/GLB écrits à la main (aucune dépendance de conversion 3D
   externe). Soudure des sommets et recalcul de normales lissées, un fichier
   par couple **(sous-région, système)**, un nœud nommé par structure.
5. Compression `@gltf-transform/cli` (Apache-2.0/MIT) en
   `--simplify false --compress meshopt` : quantification et compression
   Meshopt **uniquement**.

### ⚠️ Aucune simplification de maillage

Une version antérieure de ce pipeline appelait `gltf-transform optimize`
avec ses réglages par défaut (`--simplify true`, `--simplify-ratio 0`), ce
qui **détruisait ~70 % des triangles** (squelette : 286 346 → 85 868) et
arrondissait visiblement les cuspides dentaires. C'est corrigé : le compte
de triangles des `.glb` produits est vérifié égal à celui de la source
(4 288 248), et `tests/core/anatomy-catalog.test.ts` garde l'invariant.

La performance vient donc du **chargement sélectif** (un fichier par
région × système, région lourde chargée à la demande) et du **rendu à la
demande** (`frameloop="demand"`), jamais d'une réduction de géométrie.

Régénération complète : `./scripts/anatomy/build-assets.sh`

## Couverture réelle Tête-et-Cou

**267 structures avec maillage réel, 4 288 248 triangles**, plus 27
structures « cours » sans géométrie.

| Sous-région | Structures | Triangles |
|---|---|---|
| Cou (rachis cervical, muscles, vaisseaux, cartilages) | 77 | 945 878 |
| Crâne (os de la voûte et de la base, épicrâne) | 15 | 898 206 |
| Dents (28 dents FDI + gencives + lèvres) | 31 | 224 074 |
| Encéphale (chargé à la demande) | 74 | 1 405 946 |
| Face (os de la face, muscles mimiques) | 41 | 336 190 |
| Mâchoire (mandibule, maxillaires, masticateurs) | 16 | 341 100 |
| Orbite (globe, nerfs optiques, orbiculaires) | 13 | 136 854 |

### Structures réelles SANS maillage dans ce jeu de données

Conservées comme structures « cours » (nom, nom latin, recherche, IA,
flashcards) mais **jamais dessinées** : nerf trijumeau et ses branches
(V1/V2/V3, alvéolaire inférieur, lingual, infra-orbitaire, massétérique),
nerf facial, nerf hypoglosse, carotides externe/interne, artères maxillaire,
faciale, linguale, alvéolaire inférieure, glandes parotide, submandibulaire
et sublinguale, langue, ATM, ligament parodontal, émail, dentine, pulpe, os
alvéolaire, sinus maxillaire.

Vérifié sur la totalité des 934 maillages du jeu de données : aucune glande
salivaire, aucune langue, aucun ossicule, aucun sinus paranasal, et aucun
nerf crânien hormis les nerfs et tractus optiques. Les dents de sagesse
(18/28/38/48) sont également absentes — d'où 28 dents et non 32.

L'absence de maillage est un état honnête et affiché comme tel, jamais
comblé par une géométrie inventée.

## Ce qui n'est PAS dans ce sous-ensemble

Le reste du corps (tronc, membres) n'a pas été converti pour cette étape —
seule la région Tête et Cou reçoit des structures individuellement nommées
et sélectionnables.
