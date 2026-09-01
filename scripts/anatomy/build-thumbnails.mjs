#!/usr/bin/env node
/**
 * Génère une VIGNETTE par structure, à partir de sa géométrie RÉELLE.
 *
 * Pourquoi pas un rendu WebGL : l'environnement de build n'a pas de GPU
 * (Chromium y rend via SwiftShader). On rastérise donc directement le
 * maillage en Node — ce qui est de toute façon plus rapide, déterministe et
 * sans dépendance graphique.
 *
 * Méthode, entièrement dérivée des données :
 *   1. lecture du STL source de la structure ;
 *   2. rotation -90° autour de X (même correction d'axe que le visualiseur,
 *      les données BodyParts3D sont Z-haut) ;
 *   3. projection orthographique ANTÉRIEURE, cadrée sur la boîte englobante ;
 *   4. rastérisation des triangles avec z-buffer et ombrage lambertien
 *      d'après la normale réelle de chaque face ;
 *   5. teinte selon le système (os, muscle, nerf, vaisseau, organe) ;
 *   6. écriture d'un PNG 64×64 avec canal alpha.
 *
 * Aucune image n'est inventée : une structure sans maillage n'a pas de
 * vignette, et l'interface affiche alors une pastille neutre « pas de 3D ».
 *
 * Usage : node scripts/anatomy/build-thumbnails.mjs
 * Sortie : public/anatomy/thumbs/<id>.png
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STL_DIR = path.resolve(
  REPO_ROOT, '..', 'kevin-mattheus-moerman', 'bodyparts3d', 'assets', 'BodyParts3D_data', 'stl',
);
const CATALOG = path.join(REPO_ROOT, 'src', 'data', 'anatomy', 'bodyCatalog.json');
const OUT_DIR = path.join(REPO_ROOT, 'public', 'anatomy', 'thumbs');

const SIZE = 64;

/**
 * Teintes lues dans `src/data/anatomy/systemPalette.json` — le même fichier
 * que le convertisseur GLB et l'interface. Le PNG écrit ici est interprété
 * en sRGB par le navigateur : on utilise donc le champ `hex` (sRGB) et non
 * le `linear` du glTF, pour que la vignette et le maillage affichent
 * réellement la même couleur à l'écran.
 */
const PALETTE = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'src', 'data', 'anatomy', 'systemPalette.json'), 'utf8'),
);
const rgbOf = (key) => {
  const hex = PALETTE.systems[key].hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
};
const VEIN_RE = new RegExp(PALETTE.vesselPatterns.vein, 'i');
const ARTERY_RE = new RegExp(PALETTE.vesselPatterns.artery, 'i');

/**
 * Clé de système d'une structure — identique à `systemKeyOf` côté interface :
 * les dents sortent du squelette, les vaisseaux se scindent en artères
 * (rouge) et veines (bleu) d'après le nom réel de la structure.
 */
function systemKeyOf(entry) {
  if (entry.category === 'squelette') return entry.subregion === 'dents' ? 'dents' : 'os';
  if (entry.category !== 'vaisseaux') return entry.category;
  if (VEIN_RE.test(entry.name)) return 'veines';
  if (ARTERY_RE.test(entry.name)) return 'arteres';
  return 'vaisseaux';
}

function parseBinaryStl(buffer) {
  const triCount = buffer.readUInt32LE(80);
  const tris = new Float32Array(triCount * 9);
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    offset += 12; // normale du fichier ignorée : recalculée par face ci-dessous
    for (let v = 0; v < 3; v++) {
      const b = t * 9 + v * 3;
      tris[b] = buffer.readFloatLE(offset);
      tris[b + 1] = buffer.readFloatLE(offset + 4);
      tris[b + 2] = buffer.readFloatLE(offset + 8);
      offset += 12;
    }
    offset += 2;
  }
  return tris;
}

/** Encode un buffer RGBA en PNG (sans dépendance : en-tête + IDAT deflaté + CRC). */
function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtre « None »
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rastérise le maillage en vue de face et rend un PNG RGBA. */
function renderThumbnail(tris, rgb) {
  const n = tris.length / 9;

  // Correction d'axe Z-haut → Y-haut (identique au visualiseur), puis
  // recherche de la boîte englobante en espace écran.
  const px = new Float32Array(n * 9);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n * 3; i++) {
    const x = tris[i * 3];
    const y = tris[i * 3 + 1];
    const z = tris[i * 3 + 2];
    // Rotation -90° autour de X (Z-haut → Y-haut) puis vue ANTÉRIEURE :
    // la profondeur croît vers l'arrière, x est inversé pour garder la
    // convention des planches d'anatomie (droite du sujet à gauche).
    const rx = -x, ry = z, rz = y;
    px[i * 3] = rx; px[i * 3 + 1] = ry; px[i * 3 + 2] = rz;
    if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    if (rz < minZ) minZ = rz; if (rz > maxZ) maxZ = rz;
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = (SIZE - 6) / Math.max(spanX, spanY);
  const offX = (SIZE - spanX * scale) / 2;
  const offY = (SIZE - spanY * scale) / 2;

  const color = new Float32Array(SIZE * SIZE * 3);
  const alpha = new Uint8Array(SIZE * SIZE);
  const depth = new Float32Array(SIZE * SIZE).fill(Infinity);

  for (let t = 0; t < n; t++) {
    const b = t * 9;
    const ax = (px[b] - minX) * scale + offX, ay = SIZE - ((px[b + 1] - minY) * scale + offY), az = px[b + 2];
    const bx = (px[b + 3] - minX) * scale + offX, by = SIZE - ((px[b + 4] - minY) * scale + offY), bz = px[b + 5];
    const cx = (px[b + 6] - minX) * scale + offX, cy = SIZE - ((px[b + 7] - minY) * scale + offY), cz = px[b + 8];

    // Normale réelle de la face, en espace corrigé — sert à l'ombrage.
    const ux = px[b + 3] - px[b], uy = px[b + 4] - px[b + 1], uz = px[b + 5] - px[b + 2];
    const vx = px[b + 6] - px[b], vy = px[b + 7] - px[b + 1], vz = px[b + 8] - px[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    // Lumière depuis la caméra, décalée en haut à gauche. La caméra regarde
    // vers +z (le z-buffer garde le plus petit z), donc une face visible a une
    // normale à composante z NÉGATIVE : le terme z de la lumière l'est aussi.
    const lambert = Math.max(0, nx * -0.35 + ny * 0.45 + nz * -0.82);
    const shade = 0.42 + 0.58 * lambert;

    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const sx = x + 0.5, sy = y + 0.5;
        const w0 = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / area;
        const w1 = ((cx - bx) * (sy - by) - (cy - by) * (sx - bx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = az * w1 + bz * w2 + cz * w0;
        const idx = y * SIZE + x;
        if (z >= depth[idx]) continue;
        depth[idx] = z;
        color[idx * 3] = rgb[0] * shade;
        color[idx * 3 + 1] = rgb[1] * shade;
        color[idx * 3 + 2] = rgb[2] * shade;
        alpha[idx] = 255;
      }
    }
  }

  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    rgba[i * 4] = Math.round(color[i * 3]);
    rgba[i * 4 + 1] = Math.round(color[i * 3 + 1]);
    rgba[i * 4 + 2] = Math.round(color[i * 3 + 2]);
    rgba[i * 4 + 3] = alpha[i];
  }
  return encodePng(rgba, SIZE, SIZE);
}

function main() {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const meshed = catalog.filter((e) => e.hasMesh && e.fmaId);

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  let bytes = 0;
  for (const entry of meshed) {
    const stl = path.join(STL_DIR, `${entry.fmaId}.stl`);
    if (!existsSync(stl)) continue;
    const tris = parseBinaryStl(readFileSync(stl));
    const rgb = rgbOf(systemKeyOf(entry));
    const png = renderThumbnail(tris, rgb);
    writeFileSync(path.join(OUT_DIR, `${entry.id}.png`), png);
    written++;
    bytes += png.length;
  }

  console.log(`${written} vignettes écrites dans ${OUT_DIR}`);
  console.log(`Poids total : ${(bytes / 1024).toFixed(0)} Ko (${(bytes / written).toFixed(0)} octets en moyenne)`);
  console.log(`${catalog.length - meshed.length} structures « cours » sans vignette — aucune image inventée pour elles.`);
}

main();
