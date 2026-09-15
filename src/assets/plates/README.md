# Planches de fond — remplacer un dessin par une vraie planche

Dépose ici une image et elle remplacera automatiquement le dessin
correspondant dans le fond de l'application. Aucun code à modifier : le nom
du fichier suffit.

| Nom du fichier         | Ce qu'il remplace                          |
|------------------------|--------------------------------------------|
| `crane.*`              | le crâne, en bas à gauche                   |
| `cerveau.*`            | l'encéphale, en haut à droite               |
| `dent.*`               | la dent en coupe, à mi-hauteur à droite     |
| `arcade.*`             | l'arcade dentaire, en bas à droite          |

Extensions acceptées : `.svg`, `.png`, `.webp`, `.avif`, `.jpg`.
Le `.svg` est préférable — il reste net à toutes les tailles et pèse moins.

Sans fichier, la planche dessinée dans `StudyPlates.tsx` est utilisée : rien
ne casse si le dossier reste vide.

## Ce qui marche bien ici

Le fond est un FILIGRANE : l'image est affichée en monochrome, à environ 8 %
d'opacité derrière un contenu opaque. Une planche au TRAIT sur fond
transparent ou blanc donne le meilleur résultat ; une photographie ou un
rendu 3D très contrasté devient une tache grise.

## Droits

N'y dépose que des images que tu as le droit de redistribuer — l'application
est publiée sur GitHub Pages, donc ces fichiers seront publics. Les planches
du *Gray's Anatomy* de 1918 (Wikimedia Commons) sont dans le domaine public
et conviennent parfaitement ; note la source et la licence dans ce fichier
au moment où tu ajoutes une image.

| Fichier ajouté | Source | Licence |
|----------------|--------|---------|
| _(aucun pour l'instant)_ | | |
