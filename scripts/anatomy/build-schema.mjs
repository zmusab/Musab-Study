#!/usr/bin/env node
/**
 * Génère le SCHÉMA ANATOMIQUE INTERACTIF de l'exploration par région.
 *
 * Ce n'est PAS un dessin : c'est un rendu du corps réel, obtenu en
 * rastérisant les 931 maillages BodyParts3D (tout sauf le tégument, qui
 * masquerait l'intérieur) dans une seule projection de face. Chaque pixel
 * garde la région et la sous-région de la structure qui l'occupe — les
 * zones cliquables du schéma sont donc issues de la géométrie, pas
 * placées à la main.
 *
 * Produit dans `public/anatomy/schema/` :
 *   - `body.png`          : le corps rendu, teinté par région ;
 *   - `region-<id>.png`   : surbrillance d'une région (silhouette réelle) ;
 *   - `sub-<id>.png`      : surbrillance d'une sous-région ;
 * et dans `src/data/anatomy/schemaMap.json` la carte des points d'accroche
 * (taille de l'image, et pour chaque zone son nombre de pixels visibles,
 * sa boîte et un point d'ancrage garanti à l'intérieur de la zone).
 *
 * Une région sans aucun pixel visible n'apparaît pas dans la carte : on ne
 * fabrique pas de zone cliquable pour une anatomie qu'on ne rend pas.
 *
 * Usage : node scripts/anatomy/build-schema.mjs
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
const OUT_DIR = path.join(REPO_ROOT, 'public', 'anatomy', 'schema');
const MAP_FILE = path.join(REPO_ROOT, 'src', 'data', 'anatomy', 'schemaMap.json');

// Résolution du schéma. Elle sert à deux échelles très différentes : la
// vignette du rail (~130 px de large) ET le schéma agrandi en modale, où une
// région est recadrée puis affichée sur ~500 px. Un rendu à 260×660 y était
// visiblement pixelisé — d'où ce doublement.
const WIDTH = 520;
const HEIGHT = 1320;
const MARGIN = 12;

/** Le tégument recouvrirait tout le corps : on l'exclut du schéma. */
const EXCLUDED_SUBREGIONS = new Set(['tegument']);

/** Teinte de base par région — sert à distinguer les zones au premier coup d'œil. */
const REGION_RGB = {
  'tete-et-cou': [214, 198, 172],
  tronc: [196, 158, 150],
  'membre-superieur': [176, 168, 196],
  'membre-inferieur': [168, 186, 176],
  corps: [180, 180, 180],
};
const HIGHLIGHT_RGB = [79, 91, 213];

function parseBinaryStl(buffer) {
  const triCount = buffer.readUInt32LE(80);
  const tris = new Float32Array(triCount * 9);
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    offset += 12;
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

const CRC = (() => {
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
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
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
function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const drawn = catalog.filter(
    (e) => e.hasMesh && e.fmaId && !EXCLUDED_SUBREGIONS.has(e.subregion) && existsSync(path.join(STL_DIR, `${e.fmaId}.stl`)),
  );

  // ── Passe 1 : boîte englobante commune à tout le corps, pour un cadrage
  // identique d'une zone à l'autre (toutes les images se superposent).
  const meshes = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const entry of drawn) {
    const tris = parseBinaryStl(readFileSync(path.join(STL_DIR, `${entry.fmaId}.stl`)));
    const n = tris.length / 3;
    const px = new Float32Array(tris.length);
    for (let i = 0; i < n; i++) {
      const x = tris[i * 3], y = tris[i * 3 + 1], z = tris[i * 3 + 2];
      // Même correction d'axe que le visualiseur (Z-haut → Y-haut), puis vue
      // ANTÉRIEURE : la profondeur croît vers l'arrière du corps, et x est
      // inversé pour que la droite anatomique reste à gauche de l'image,
      // comme sur une planche classique.
      const rx = -x, ry = z, rz = y;
      px[i * 3] = rx; px[i * 3 + 1] = ry; px[i * 3 + 2] = rz;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    }
    meshes.push({ entry, px });
  }

  const scale = Math.min((WIDTH - 2 * MARGIN) / (maxX - minX), (HEIGHT - 2 * MARGIN) / (maxY - minY));
  const offX = (WIDTH - (maxX - minX) * scale) / 2;
  const offY = (HEIGHT - (maxY - minY) * scale) / 2;

  // ── Passe 2 : rastérisation commune, avec z-buffer partagé.
  const N = WIDTH * HEIGHT;
  const depth = new Float32Array(N).fill(Infinity);
  const shade = new Float32Array(N);
  const regionIdx = new Int16Array(N).fill(-1);
  const subIdx = new Int16Array(N).fill(-1);

  const regionIds = [...new Set(drawn.map((e) => e.region))];
  const subIds = [...new Set(drawn.map((e) => e.subregion))];

  for (const { entry, px } of meshes) {
    const ri = regionIds.indexOf(entry.region);
    const si = subIds.indexOf(entry.subregion);
    const triCount = px.length / 9;
    for (let t = 0; t < triCount; t++) {
      const b = t * 9;
      const ax = (px[b] - minX) * scale + offX, ay = HEIGHT - ((px[b + 1] - minY) * scale + offY), az = px[b + 2];
      const bx = (px[b + 3] - minX) * scale + offX, by = HEIGHT - ((px[b + 4] - minY) * scale + offY), bz = px[b + 5];
      const cx = (px[b + 6] - minX) * scale + offX, cy = HEIGHT - ((px[b + 7] - minY) * scale + offY), cz = px[b + 8];

      const ux = px[b + 3] - px[b], uy = px[b + 4] - px[b + 1], uz = px[b + 5] - px[b + 2];
      const vx = px[b + 6] - px[b], vy = px[b + 7] - px[b + 1], vz = px[b + 8] - px[b + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const lambert = Math.max(0, nx * -0.35 + ny * 0.45 + nz * -0.82);
      const lit = 0.45 + 0.55 * lambert;

      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(WIDTH - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(HEIGHT - 1, Math.ceil(Math.max(ay, by, cy)));
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
          const idx = y * WIDTH + x;
          if (z >= depth[idx]) continue;
          depth[idx] = z;
          shade[idx] = lit;
          regionIdx[idx] = ri;
          subIdx[idx] = si;
        }
      }
    }
  }

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // ── Image de base : le corps, teinté par région.
  const body = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    if (regionIdx[i] < 0) continue;
    const rgb = REGION_RGB[regionIds[regionIdx[i]]] ?? [180, 180, 180];
    body[i * 4] = Math.round(rgb[0] * shade[i]);
    body[i * 4 + 1] = Math.round(rgb[1] * shade[i]);
    body[i * 4 + 2] = Math.round(rgb[2] * shade[i]);
    body[i * 4 + 3] = 255;
  }
  writeFileSync(path.join(OUT_DIR, 'body.png'), encodePng(body, WIDTH, HEIGHT));

  /** Silhouette en surbrillance d'une zone + ses métadonnées de clic. */
  const emit = (prefix, ids, indexBuffer) => {
    const zones = [];
    for (let k = 0; k < ids.length; k++) {
      const layer = Buffer.alloc(N * 4);
      let count = 0, sumX = 0, sumY = 0;
      let bx0 = WIDTH, by0 = HEIGHT, bx1 = 0, by1 = 0;
      for (let i = 0; i < N; i++) {
        if (indexBuffer[i] !== k) continue;
        const x = i % WIDTH, y = (i / WIDTH) | 0;
        count++; sumX += x; sumY += y;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
        layer[i * 4] = Math.round(HIGHLIGHT_RGB[0] * shade[i] + 40);
        layer[i * 4 + 1] = Math.round(HIGHLIGHT_RGB[1] * shade[i] + 40);
        layer[i * 4 + 2] = Math.round(HIGHLIGHT_RGB[2] * shade[i] + 40);
        layer[i * 4 + 3] = 255;
      }
      if (count === 0) continue; // aucune zone inventée pour une région non rendue
      writeFileSync(path.join(OUT_DIR, `${prefix}-${ids[k]}.png`), encodePng(layer, WIDTH, HEIGHT));

      // Point d'accroche : barycentre ramené sur un pixel réellement occupé
      // par la zone (un membre en U aurait sinon son ancre dans le vide).
      const cx = sumX / count, cy = sumY / count;
      let best = null, bestD = Infinity;
      for (let i = 0; i < N; i++) {
        if (indexBuffer[i] !== k) continue;
        const x = i % WIDTH, y = (i / WIDTH) | 0;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestD) { bestD = d; best = [x, y]; }
      }
      zones.push({ id: ids[k], pixels: count, box: [bx0, by0, bx1, by1], anchor: best });
    }
    return zones;
  };

  const map = {
    width: WIDTH,
    height: HEIGHT,
    regions: emit('region', regionIds, regionIdx),
    subregions: emit('sub', subIds, subIdx),
  };
  writeFileSync(MAP_FILE, `${JSON.stringify(map, null, 2)}\n`);

  const painted = Array.from(regionIdx).filter((v) => v >= 0).length;
  console.log(`Schéma ${WIDTH}×${HEIGHT} — ${painted} pixels rendus depuis ${drawn.length} maillages réels`);
  console.log(`${map.regions.length} régions et ${map.subregions.length} sous-régions cliquables`);
}

main();
