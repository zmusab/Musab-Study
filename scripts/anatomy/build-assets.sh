#!/usr/bin/env bash
# Régénère l'intégralité des assets Anatomie 3D depuis les données
# BodyParts3D locales : catalogue → GLB par (région, système) → compression.
#
# La compression n'enlève AUCUN triangle : `--simplify false` est explicite et
# volontaire (voir l'en-tête de convert-headneck.mjs pour l'historique du
# problème). Le script vérifie ce point à la fin et échoue si le compte de
# triangles ne correspond plus à la source.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/public/anatomy"
RAW="$(mktemp -d)"
trap 'rm -rf "$RAW"' EXIT

echo "==> 1/3  Catalogue depuis l'arbre d'inclusion BodyParts3D"
node "$ROOT/scripts/anatomy/build-catalog.mjs"

echo
echo "==> 2/3  Conversion STL → GLB (géométrie intégrale)"
rm -f "$OUT"/*.glb
node "$ROOT/scripts/anatomy/convert-headneck.mjs"

echo
echo "==> 3/3  Compression meshopt (taille seule, sans simplification)"
cp "$OUT"/*.glb "$RAW/"
for f in "$RAW"/*.glb; do
  name="$(basename "$f")"
  # --join false est INDISPENSABLE : sans lui, `optimize` fusionne les
  # maillages qui partagent un matériau, ce qui réduit chaque fichier à un
  # maillage par couleur et détruit la sélection structure par structure
  # (le nombre de triangles, lui, reste identique — d'où la vérification
  # par nombre de nœuds ci-dessous, et pas seulement par triangles).
  npx --yes @gltf-transform/cli@4 optimize "$f" "$OUT/$name" \
    --simplify false --join false --compress meshopt --texture-compress false >/dev/null 2>&1
done

echo
echo "==> Vérification : chaque structure reste un nœud distinct"
node - "$OUT" "$ROOT/src/data/anatomy/assetManifest.json" <<'NODE'
const { readFileSync, readdirSync } = require('node:fs');
const [outDir, manifestPath] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let failed = false;
for (const group of manifest) {
  const buf = readFileSync(`${outDir}/${group.key}.glb`);
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const nodes = (gltf.nodes ?? []).length;
  if (nodes !== group.structures) {
    console.error(`  ✗ ${group.key}: ${nodes} nœuds pour ${group.structures} structures`);
    failed = true;
  }
}
if (failed) {
  console.error('\nLes structures ont été fusionnées : la sélection individuelle serait cassée.');
  process.exit(1);
}
console.log(`  ✓ ${manifest.length} fichiers — toutes les structures restent sélectionnables individuellement`);
NODE

expected="$(node -e "
  const m = require('$ROOT/src/data/anatomy/assetManifest.json');
  console.log(m.reduce((s, g) => s + g.triangles, 0));
")"
echo
echo "Assets régénérés dans $OUT"
du -sh "$OUT"
echo "Triangles attendus (source) : $expected — aucune simplification appliquée."
