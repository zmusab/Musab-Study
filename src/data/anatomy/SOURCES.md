# Source des modèles 3D — Anatomie, corps entier

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
2. **`scripts/anatomy/build-catalog.mjs`** génère `bodyCatalog.json` depuis
   l'**arbre d'inclusion officiel** (`conventional_part_of.txt`, le même que
   l'onglet « Tree » du BP3D Viewer). La couverture est désormais le **corps
   entier** : chaque maillage du jeu de données est rattaché à une région et
   à une sous-région (`scripts/anatomy/regionTree.mjs`) et à un système, en
   remontant l'arbre officiel. La sélection n'est donc pas une liste écrite
   à la main, et **aucun maillage disponible n'est laissé de côté** : les 934
   STL du jeu de données sont tous catalogués.
3. Les noms français et latins viennent de **`scripts/anatomy/naming.mjs`**,
   seule couche non lue directement dans la source (BodyParts3D ne fournit
   qu'un libellé anglais). Le nom latin n'est renseigné que lorsqu'il est
   certain — sinon `null`, et l'interface n'affiche alors aucun latin plutôt
   qu'une approximation. Toute structure présente dans les données mais
   absente du dictionnaire **fait échouer la génération**.
4. **`scripts/anatomy/convert-meshes.mjs`** : parseur STL binaire +
   écrivain glTF/GLB écrits à la main (aucune dépendance de conversion 3D
   externe). Soudure des sommets et recalcul de normales lissées, un fichier
   par couple **(sous-région, système)**, un nœud nommé par structure.
5. Compression `@gltf-transform/cli` (Apache-2.0/MIT) en
   `--simplify false --join false --compress meshopt` : quantification et
   compression Meshopt **uniquement**. `--join false` est indispensable —
   sans lui, `optimize` fusionne les maillages partageant un matériau, ce
   qui conserve le nombre de triangles mais détruit la sélection structure
   par structure. Le pipeline le vérifie en comparant le **nombre de nœuds**
   de chaque `.glb` au nombre de structures du manifeste.
6. **`scripts/anatomy/build-thumbnails.mjs`** rastérise chaque maillage en
   une vignette PNG 64×64 (projection antérieure, z-buffer, ombrage
   lambertien d'après les normales réelles, teinte du système). Ces
   vignettes remplacent les émojis dans toute l'interface. Une structure
   sans maillage n'a **pas** de vignette : l'interface affiche alors une
   pastille « géométrie 3D non disponible ».
7. **`scripts/anatomy/build-schema.mjs`** rend les 931 maillages (tout sauf
   le tégument, qui masquerait l'intérieur) dans une seule projection
   antérieure 520×1320 et mémorise, pour chaque pixel, la région et la
   sous-région qui l'occupent. Cette résolution sert deux échelles : la
   vignette du rail (~130 px) et le schéma agrandi en modale, où une région
   est recadrée puis affichée sur ~500 px. Il en tire l'image du schéma, une silhouette
   de surbrillance par zone, et `schemaMap.json` (ancre et cadre de chaque
   zone). Les zones cliquables de « Exploration par région » viennent donc
   de la géométrie, pas d'un tracé à la main — et une zone invisible de face
   (encéphale, dos) n'a **aucune** zone inventée.

### ⚠️ Aucune simplification de maillage

Une version antérieure de ce pipeline appelait `gltf-transform optimize`
avec ses réglages par défaut (`--simplify true`, `--simplify-ratio 0`), ce
qui **détruisait ~70 % des triangles** (squelette : 286 346 → 85 868) et
arrondissait visiblement les cuspides dentaires. C'est corrigé : le compte
de triangles des `.glb` produits est vérifié égal à celui de la source
(26 317 506), et `tests/core/anatomy-catalog.test.ts` garde l'invariant.

La performance vient donc du **chargement sélectif** (un fichier par
région × système, région lourde chargée à la demande) et du **rendu à la
demande** (`frameloop="demand"`), jamais d'une réduction de géométrie.

Régénération complète : `./scripts/anatomy/build-assets.sh`

## Couverture réelle — corps entier

**934 structures avec maillage réel, 26 317 506 triangles**, réparties en
**47 fichiers `.glb` (106 Mo)**, plus 27 structures « cours » sans géométrie.
S'y ajoutent 934 vignettes PNG (1,4 Mo) et le schéma corporel (1,5 Mo).

| Région | Structures | Triangles |
|---|---|---|
| Tête et cou | 278 | 4 745 318 |
| Tronc | 264 | 10 314 170 |
| Membre supérieur | 196 | 4 638 054 |
| Membre inférieur | 193 | 4 914 776 |
| Général (tégument) | 3 | 1 705 188 |

| Sous-région | Région | Structures | Triangles |
|---|---|---|---|
| Crâne | Tête et cou | 27 | 940 878 |
| Face | Tête et cou | 36 | 378 958 |
| Mâchoire et bouche | Tête et cou | 16 | 341 100 |
| Dents (28 dents FDI) | Tête et cou | 31 | 224 074 |
| Orbite | Tête et cou | 6 | 51 414 |
| Cou | Tête et cou | 68 | 814 850 |
| Encéphale (à la demande) | Tête et cou | 94 | 1 994 044 |
| Thorax | Tronc | 112 | 4 759 754 |
| Abdomen | Tronc | 76 | 3 564 756 |
| Bassin | Tronc | 20 | 25 614 |
| Dos | Tronc | 56 | 1 964 046 |
| Épaule | Membre supérieur | 46 | 2 311 440 |
| Bras | Membre supérieur | 14 | 380 274 |
| Coude | Membre supérieur | 18 | 467 328 |
| Avant-bras | Membre supérieur | 38 | 1 208 376 |
| Main | Membre supérieur | 80 | 270 636 |
| Hanche | Membre inférieur | 25 | 672 404 |
| Cuisse | Membre inférieur | 34 | 2 098 846 |
| Genou | Membre inférieur | 2 | 2 672 |
| Jambe | Membre inférieur | 34 | 1 453 754 |
| Pied | Membre inférieur | 98 | 687 100 |
| Tégument | Général | 3 | 1 705 188 |

Le « genou » ne compte que 2 maillages (les ménisques) : dans l'arbre
officiel, fémur, tibia, patella et ligaments croisés sont rattachés à la
cuisse et à la jambe. Le compte reflète l'arbre source, il n'est pas corrigé
à la main.

### Ce qui est chargé, et quand

Le dépôt porte 100 % des données ; le navigateur n'en charge qu'une fraction.

| Moment | Contenu | Poids |
|---|---|---|
| Palier 1, immédiat | crâne, face, mâchoire, dents — ce que la caméra cadre | **7,8 Mo** (9 fichiers) |
| Palier 2, en arrière-plan | cou et orbite, qui complètent la vue | 3,7 Mo (6 fichiers) |
| À la demande | toute autre sous-région, au moment où on l'ouvre | selon la région |

Un groupe dont la sous-région **sort du périmètre est démonté et purgé** du
cache de `useGLTF` : parcourir tête → thorax → abdomen → main gardait sinon
toute leur géométrie vivante, et la page finissait par ne plus répondre. Le
fichier reste en cache HTTP et dans le service worker, y revenir ne
retélécharge rien.

### Coût des assets — arbitrage assumé

106 Mo de `.glb` contre 17 Mo pour la version « tête et cou » précédente.
C'est le prix de deux choix explicites : aucune simplification de maillage,
et la couverture du corps entier. Conséquences réelles :

- **À l'usage**, un utilisateur qui ouvre Anatomie ne télécharge que la tête
  et le cou (~12 Mo) ; chaque autre région n'arrive que lorsqu'on l'ouvre.
- **Le service worker** ne pré-cache ni les `.glb`, ni les vignettes, ni le
  schéma (`globIgnores` + `runtimeCaching`) : le pré-cache de la PWA reste à
  62 entrées / 2,9 Mo. Ils sont mis en cache au fil de la consultation.
- **Le dépôt et le déploiement**, eux, portent bien les 108 Mo.

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

## Couleurs : une seule source pour la 3D et l'interface

`systemPalette.json` (à côté de ce fichier) est la **source unique** des
couleurs par système. Trois consommateurs le lisent :

| Consommateur | Champ utilisé | Pourquoi |
|---|---|---|
| `scripts/anatomy/convert-meshes.mjs` | `linear` | `baseColorFactor` glTF, espace linéaire |
| `scripts/anatomy/build-thumbnails.mjs` | `hex` | pixels PNG, interprétés en sRGB |
| `src/services/anatomy/systemColors.ts` | `hex` | pastilles, liserés et points du DOM |

`hex` est **exactement** l'encodage sRGB de `linear` — un test
(`tests/core/anatomy-system-colors.test.ts`) le vérifie, de sorte qu'une
pastille de l'interface et le maillage qu'elle désigne ne peuvent pas
afficher deux teintes différentes. Convention retenue : os et dents ivoire,
muscle rouge, système nerveux jaune, artère rouge, veine bleue, organes rose
tissu.

### Artères et veines

La distinction n'est pas décorative : elle est écrite **dans la géométrie**.
`vesselPatterns` classe chaque vaisseau d'après son nom français réel, la
veine étant testée avant l'artère (« sinus coronaire » est un collecteur
veineux malgré le mot « coronaire »). Les **62 vaisseaux** du catalogue sont
tous classés — 38 artères, 24 veines, aucun reste — et les quatre fichiers
`*-vaisseaux.glb` portent deux matériaux distincts. Un test échoue si une
structure `vaisseaux` cesse d'être classée.

## Ce qui n'est PAS dans ce jeu de données

La totalité des maillages disponibles est intégrée : il n'y a plus de région
volontairement laissée de côté. Ce qui manque manque **dans la source**.

### Les nerfs — mesure exacte, pas une impression

`parts_list_e.txt` a été passé au crible sur `nerve`, `ganglion`, `plexus` et
`trunk of`. Le jeu de données entier contient **un seul nerf nommé** :

| Identifiant | Libellé source |
|---|---|
| `FMA50863` | optic nerve |
| `FMA50875` | right optic nerve |
| `FMA50878` | left optic nerve |

Aucun autre nerf crânien, aucun nerf périphérique, aucun plexus, aucun
ganglion. Ce que la catégorie « nerfs » contient réellement, ce sont les
**99 structures du système nerveux central** (encéphale, tronc cérébral,
cervelet, capsule interne, corps calleux…) plus les nerfs et tractus
optiques. C'est pourquoi le sélecteur de système est libellé **« Système
nerveux »** et non « Nerfs » : l'appeler « Nerfs » laisserait croire qu'on y
trouve le trijumeau ou le facial.

Les nerfs réellement utiles en dentisterie — trijumeau et ses branches
V1/V2/V3, alvéolaire inférieur, lingual, infra-orbitaire, facial,
hypoglosse, massétérique — restent au catalogue comme structures
**« cours uniquement »** : nommées, recherchables, explicables par l'IA,
et affichées avec une pastille « géométrie 3D non disponible ». Aucune
géométrie n'est fabriquée pour combler ce manque, et aucune autre source
n'a été intégrée sans licence vérifiée (Z-Anatomy a été écarté : sa
distribution mêle des composants NC à une licence BY-SA).
