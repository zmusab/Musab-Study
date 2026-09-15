#!/usr/bin/env node
/**
 * Convertit le jeu de données réel BodyParts3D/Anatomography (DBCLS,
 * CC BY-SA 2.1 Japan) — cloné en lecture seule depuis
 * https://github.com/Kevin-Mattheus-Moerman/BodyParts3D, lui-même une
 * conversion OBJ→STL binaire du jeu de données officiel version 3.0
 * (20110915) — en fichiers glTF binaire (.glb), un par couple
 * (sous-région, système), pour être chargés indépendamment dans le
 * visualiseur 3D.
 *
 * La couverture est le CORPS ENTIER : le script convertit tout ce que
 * `bodyCatalog.json` déclare maillé, soit les 934 maillages du jeu de
 * données. (L'ancien nom `convert-headneck.mjs` datait de l'étape où seule
 * la tête et le cou étaient convertis.)
 *
 * Aucune dépendance externe : parseur STL binaire et écrivain glTF/GLB
 * écrits à la main (le format est simple, pas de texture/UV nécessaire —
 * seulement position + normale par sommet + une couleur de matériau par
 * catégorie).
 *
 * RÈGLE ABSOLUE — AUCUNE SIMPLIFICATION DE MAILLAGE
 * -------------------------------------------------
 * Ce script conserve INTÉGRALEMENT la géométrie source. Une version
 * antérieure passait la sortie dans `gltf-transform optimize` avec ses
 * réglages par défaut (`--simplify true`, `--simplify-ratio 0`), ce qui
 * détruisait ~70 % des triangles (286 346 → 85 868 pour le squelette) et
 * arrondissait visiblement les cuspides dentaires. La réduction de poids
 * doit venir de la COMPRESSION (meshopt, quantification) et du CHARGEMENT
 * PROGRESSIF, jamais de la destruction de détail anatomique.
 *
 * Le jeu de données lui-même est déjà le palier le plus précis publiquement
 * distribué par le DBCLS (« polygon reduction rate = 95 % », cinq fois plus
 * de polygones que le palier 99 %) : simplifier davantage revient à jeter la
 * seule précision disponible.
 *
 * Usage : node scripts/anatomy/build-catalog.mjs && node scripts/anatomy/convert-meshes.mjs
 * Source des .stl : ../kevin-mattheus-moerman/bodyparts3d/assets/BodyParts3D_data/stl
 * Sortie : public/anatomy/<region>-<systeme>.glb + manifest.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STL_DIR = path.resolve(REPO_ROOT, '..', 'kevin-mattheus-moerman', 'bodyparts3d', 'assets', 'BodyParts3D_data', 'stl');
const CATALOG_PATH = path.join(REPO_ROOT, 'src', 'data', 'anatomy', 'bodyCatalog.json');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'anatomy');

/**
 * Les couleurs ne sont PAS écrites ici : elles viennent de
 * `src/data/anatomy/systemPalette.json`, que lit également l'interface
 * (`src/services/anatomy/systemColors.ts`). Une pastille de l'interface et
 * le maillage correspondant ne peuvent donc pas afficher deux teintes
 * différentes. `linear` est l'espace du `baseColorFactor` glTF ; le champ
 * `hex` du même fichier en est l'encodage sRGB, pour le DOM.
 */
const PALETTE = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'src', 'data', 'anatomy', 'systemPalette.json'), 'utf8'),
);
const colorOf = (key) => PALETTE.systems[key].linear;
const CATEGORY_COLOR = {
  squelette: colorOf('os'),
  muscles: colorOf('muscles'),
  organes: colorOf('organes'),
  nerfs: colorOf('nerfs'),
  vaisseaux: colorOf('vaisseaux'),
};
const VESSEL_COLOR = { artery: colorOf('arteres'), vein: colorOf('veines') };
const VEIN_RE = new RegExp(PALETTE.vesselPatterns.vein, 'i');
const ARTERY_RE = new RegExp(PALETTE.vesselPatterns.artery, 'i');
/**
 * Artère ou veine : déduit du nom français généré, pas d'un champ saisi à la
 * main. La veine est testée en premier — « sinus coronaire » est un
 * collecteur veineux et doit rester bleu malgré le mot « coronaire ».
 */
const vesselTypeOf = (structure) =>
  VEIN_RE.test(structure.name) ? 'vein' : ARTERY_RE.test(structure.name) ? 'artery' : null;

/**
 * Parse un fichier STL binaire : 80 octets d'en-tête + uint32 nb triangles +
 * triangles (normale + 3 sommets, 4 octets/float, 2 octets d'attribut
 * ignorés). Les normales PAR FACE du fichier STL sont ignorées ici : les
 * STL BodyParts3D ne partagent aucun sommet entre triangles adjacents, donc
 * les utiliser telles quelles produit un rendu à facettes visibles
 * (« low-poly »), pas la forme lisse réelle de la structure. `smoothGeometry`
 * ci-dessous recalcule de vraies normales lissées à partir de la topologie
 * une fois les sommets soudés.
 */
function parseBinaryStl(buffer) {
  const triCount = buffer.readUInt32LE(80);
  const positions = new Float32Array(triCount * 9);
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    offset += 12; // normale par face du fichier — ignorée, voir ci-dessus
    for (let v = 0; v < 3; v++) {
      const base = t * 9 + v * 3;
      positions[base] = buffer.readFloatLE(offset);
      positions[base + 1] = buffer.readFloatLE(offset + 4);
      positions[base + 2] = buffer.readFloatLE(offset + 8);
      offset += 12;
    }
    offset += 2; // attribut par octet, non utilisé
  }
  return { positions, triCount };
}

/**
 * Soude les sommets proches (la géométrie STL est un "triangle soup" sans
 * partage de sommets) puis recalcule des normales lissées à partir de la
 * topologie résultante — c'est la différence entre un rendu à facettes
 * visibles et une surface anatomique lisse. Purement géométrique : la forme
 * réelle de la structure n'est pas modifiée, seul son ombrage l'est.
 */
function smoothGeometry(positions, weldTolerance = 0.05) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const merged = mergeVertices(geometry, weldTolerance);
  merged.computeVertexNormals();
  const indexAttr = merged.getIndex();
  return {
    positions: merged.getAttribute('position').array,
    normals: merged.getAttribute('normal').array,
    indices: indexAttr ? indexAttr.array : null,
  };
}

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

function align4(n) {
  return (n + 3) & ~3;
}

/**
 * Construit un GLB (JSON + BIN en un seul fichier binaire) à partir d'une
 * liste de { id, positions, normals, materialIndex }. Non indexé (triangle
 * soup) : les STL BodyParts3D ne partagent pas les sommets, un maillage
 * indexé nécessiterait une soudure des sommets — hors périmètre ici.
 */
function buildGlb(meshes, materials) {
  // Assemblage direct et séquentiel du buffer binaire : chaque bufferView est
  // écrit immédiatement après le précédent, avec son padding d'alignement 4
  // octets AVANT le chunk suivant (jamais après-coup par ré-association).
  const binParts = [];
  let byteOffset = 0;
  const pushChunk = (typedArray) => {
    const chunk = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    binParts.push(chunk);
    const start = byteOffset;
    byteOffset += chunk.length;
    const padding = align4(byteOffset) - byteOffset;
    if (padding > 0) {
      binParts.push(Buffer.alloc(padding));
      byteOffset += padding;
    }
    return { byteOffset: start, byteLength: chunk.length };
  };

  const bufferViews = [];
  const accessors = [];
  const glMeshes = [];
  const nodes = [];
  const sceneNodeIndices = [];

  for (const mesh of meshes) {
    const { positions, normals, indices, materialIndex, boundsMinMax } = mesh;
    const vertexCount = positions.length / 3;

    const posBufferView = bufferViews.length;
    const posLoc = pushChunk(positions);
    bufferViews.push({ buffer: 0, byteOffset: posLoc.byteOffset, byteLength: posLoc.byteLength, target: 34962 });

    const posAccessor = accessors.length;
    accessors.push({
      bufferView: posBufferView,
      componentType: 5126, // FLOAT
      count: vertexCount,
      type: 'VEC3',
      min: boundsMinMax.min,
      max: boundsMinMax.max,
    });

    const normBufferView = bufferViews.length;
    const normLoc = pushChunk(normals);
    bufferViews.push({ buffer: 0, byteOffset: normLoc.byteOffset, byteLength: normLoc.byteLength, target: 34962 });

    const normAccessor = accessors.length;
    accessors.push({ bufferView: normBufferView, componentType: 5126, count: vertexCount, type: 'VEC3' });

    const attributes = { POSITION: posAccessor, NORMAL: normAccessor };
    let indicesAccessor;
    if (indices) {
      const isShort = indices instanceof Uint16Array;
      const idxBufferView = bufferViews.length;
      const idxLoc = pushChunk(indices);
      bufferViews.push({ buffer: 0, byteOffset: idxLoc.byteOffset, byteLength: idxLoc.byteLength, target: 34963 });
      indicesAccessor = accessors.length;
      accessors.push({
        bufferView: idxBufferView,
        componentType: isShort ? 5123 : 5125, // UNSIGNED_SHORT / UNSIGNED_INT
        count: indices.length,
        type: 'SCALAR',
      });
    }

    const meshIndex = glMeshes.length;
    glMeshes.push({
      name: mesh.id,
      primitives: [
        {
          attributes,
          indices: indicesAccessor,
          mode: 4, // TRIANGLES
          material: materialIndex,
        },
      ],
    });

    const nodeIndex = nodes.length;
    nodes.push({ name: mesh.id, mesh: meshIndex });
    sceneNodeIndices.push(nodeIndex);
  }

  const binPadded = Buffer.concat(binParts);

  const gltfJson = {
    asset: {
      version: '2.0',
      generator: 'Musab Study — scripts/anatomy/convert-meshes.mjs',
      copyright:
        'BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan — http://lifesciencedb.jp/bp3d/',
    },
    scene: 0,
    scenes: [{ nodes: sceneNodeIndices }],
    nodes,
    meshes: glMeshes,
    materials: materials.map((color) => ({
      pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0.05, roughnessFactor: 0.4 },
    })),
    buffers: [{ byteLength: binPadded.length }],
    bufferViews,
    accessors,
  };

  const jsonStr = JSON.stringify(gltfJson);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(align4(jsonBuf.length) - jsonBuf.length, 0x20)]);

  const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binPadded.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonChunkHeader, jsonPadded, binChunkHeader, binPadded]);
}

function main() {
  if (!existsSync(STL_DIR)) {
    console.error(`Répertoire source introuvable : ${STL_DIR}`);
    process.exit(1);
  }
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  const withMesh = catalog.filter((s) => s.hasMesh);

  // Découpage RÉGION × SYSTÈME plutôt qu'un fichier par système : le
  // visualiseur ne télécharge alors que les combinaisons réellement
  // demandées (§ chargement progressif). Ouvrir « Mâchoire » avec seulement
  // « Squelette » actif ne charge ni les muscles du cou ni l'encéphale.
  const byGroup = new Map();
  for (const structure of withMesh) {
    const key = `${structure.subregion}-${structure.category}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(structure);
  }

  // `--only=<motif>` régénère UNIQUEMENT les groupes dont la clé contient le
  // motif (ex. `--only=vaisseaux`), en fusionnant le résultat dans le
  // manifeste existant au lieu de l'écraser. Sert quand seule une couleur ou
  // une classification change : inutile de reconvertir 26 M de triangles
  // pour repeindre quatre fichiers.
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length) : null;
  const MANIFEST_PATH = path.join(REPO_ROOT, 'src', 'data', 'anatomy', 'assetManifest.json');
  const previousManifest =
    only && existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : [];

  let totalTriangles = 0;
  const manifest = previousManifest.filter((g) => !g.key.includes(only ?? ''));
  for (const [groupKey, structures] of [...byGroup].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (only && !groupKey.includes(only)) continue;
    const category = structures[0].category;
    const materials = [];
    const materialIndexFor = (structure) => {
      let color = CATEGORY_COLOR[category] ?? [0.7, 0.7, 0.7];
      if (category === 'vaisseaux') {
        const vesselType = vesselTypeOf(structure);
        if (vesselType) color = VESSEL_COLOR[vesselType];
      }
      const key = color.join(',');
      let idx = materials.findIndex((m) => m.key === key);
      if (idx === -1) {
        idx = materials.length;
        materials.push({ key, color });
      }
      return idx;
    };

    const meshes = [];
    for (const structure of structures) {
      const stlPath = path.join(STL_DIR, `${structure.fmaId}.stl`);
      if (!existsSync(stlPath)) {
        console.warn(`⚠️  ${structure.fmaId}.stl introuvable pour ${structure.id} — ignoré.`);
        continue;
      }
      const buffer = readFileSync(stlPath);
      const { positions: rawPositions, triCount } = parseBinaryStl(buffer);
      const { positions, normals, indices } = smoothGeometry(rawPositions);
      totalTriangles += triCount;
      meshes.push({
        id: structure.id,
        positions,
        normals,
        indices,
        materialIndex: materialIndexFor(structure),
        boundsMinMax: boundsOf(positions),
      });
    }

    if (meshes.length === 0) {
      console.warn(`Aucun maillage réel pour « ${groupKey} » — fichier .glb non généré.`);
      continue;
    }

    const glb = buildGlb(meshes, materials.map((m) => m.color));
    const outPath = path.join(OUT_DIR, `${groupKey}.glb`);
    writeFileSync(outPath, glb);
    const triangles = structures.reduce((sum, s) => sum + (s.triangles ?? 0), 0);
    manifest.push({
      key: groupKey,
      subregion: structures[0].subregion,
      category,
      structures: meshes.length,
      triangles,
    });
    console.log(
      `✓ ${`${groupKey}.glb`.padEnd(28)} ${String(meshes.length).padStart(3)} structures  ` +
      `${triangles.toLocaleString('fr-FR').padStart(10)} tri  ${(glb.length / 1024 / 1024).toFixed(2)} Mo`,
    );
  }

  // Le manifeste est lu par le visualiseur pour savoir quels fichiers
  // existent réellement : aucun groupe n'est deviné côté client, donc aucune
  // requête vers un asset inexistant.
  manifest.sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `\nTotal : ${totalTriangles.toLocaleString('fr-FR')} triangles convertis depuis des données réelles ` +
    `BodyParts3D (CC BY-SA 2.1 Japan), en ${manifest.length} fichiers.\n` +
    `AUCUNE simplification de maillage n'est appliquée : la géométrie source est conservée intégralement.\n` +
    `Étape de compression (taille seule, sans perte de triangles) :\n` +
    `  npx @gltf-transform/cli@4 optimize <in> <out> --simplify false --join false --compress meshopt --texture-compress false`
    + `\n(utiliser plutôt ./scripts/anatomy/build-assets.sh, qui vérifie aussi que rien n'est fusionné)`,
  );
}

main();
