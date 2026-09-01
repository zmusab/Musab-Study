#!/usr/bin/env node
/**
 * Génère `src/data/anatomy/headNeckCatalog.json` À PARTIR DES DONNÉES RÉELLES
 * BodyParts3D, et non d'une liste écrite à la main.
 *
 * PRINCIPE
 * --------
 * La sélection « Tête et Cou » est dérivée de l'arbre d'inclusion officiel du
 * jeu de données (`conventional_part_of.txt`, le même arbre que l'onglet
 * « Tree » du BP3D Viewer) : on descend depuis `head` et `neck` et on garde
 * tout descendant qui possède réellement un fichier STL. Aucune structure
 * n'est choisie à la main, aucune n'est inventée : si le maillage n'existe
 * pas dans la source, la structure n'entre pas dans le catalogue avec un
 * maillage.
 *
 * Quelques structures pertinentes ne sont pas descendantes de `head`/`neck`
 * dans cet arbre (les vaisseaux et nerfs relèvent de leur propre système, le
 * cartilage thyroïde du système respiratoire) : elles sont ajoutées via
 * `EXTRA_IDS`, chacune vérifiée individuellement dans la source.
 *
 * Le nom français et le nom latin viennent de `naming.mjs` (voir l'en-tête de
 * ce fichier pour la justification). Toute structure sans entrée de
 * nomenclature FAIT ÉCHOUER la génération, afin qu'aucune structure ne puisse
 * apparaître sans nom ou être oubliée en silence.
 *
 * Usage : node scripts/anatomy/build-catalog.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { QUALIFIERS, TERMS, TOOTH_KINDS, FDI_QUADRANT, TOOTH_LATIN, withSide } from './naming.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const BP3D_DIR = path.resolve(
  REPO_ROOT, '..', 'kevin-mattheus-moerman', 'bodyparts3d', 'assets', 'BodyParts3D_data',
);
const OUT = path.join(REPO_ROOT, 'src', 'data', 'anatomy', 'headNeckCatalog.json');

/** Structures pertinentes hors sous-arbre head/neck — chacune vérifiée dans la source. */
const EXTRA_IDS = [
  'FMA3941', 'FMA4058', // artères carotides communes
  'FMA4762', 'FMA4754', // veines jugulaires internes
  'FMA50875', 'FMA50878', 'FMA62382', 'FMA67936', 'FMA62045', // nerfs/tractus/chiasma optiques
  'FMA55099', 'FMA71704', 'FMA7394', 'FMA7131', // cartilage thyroïde, cartilages du nez, trachée, œsophage
  'FMA81752', 'FMA81753', 'FMA71442', 'FMA71443', // rotateurs et intertransversaires cervicaux
  'FMA32540', 'FMA32541', // élévateurs de la scapula
  'FMA13322', 'FMA13323', 'FMA7486', // clavicules, manubrium
  'FMA13889', 'FMA71098', // hypophyse, sourcils
];

export function loadBp3d() {
  if (!existsSync(BP3D_DIR)) {
    throw new Error(
      `Données BodyParts3D introuvables : ${BP3D_DIR}\n` +
      `Cloner https://github.com/Kevin-Mattheus-Moerman/BodyParts3D à côté du dépôt.`,
    );
  }
  const rows = readFileSync(path.join(BP3D_DIR, 'conventional_part_of.txt'), 'utf8')
    .split('\n').slice(1).filter(Boolean).map((l) => l.split('\t')).filter((c) => c.length >= 4);
  const children = new Map();
  const nameOf = new Map();
  for (const [id, name, pid, pname] of rows) {
    nameOf.set(id, name);
    nameOf.set(pid, pname);
    if (!children.has(id)) children.set(id, new Set());
    children.get(id).add(pid);
  }
  // parts_list_e.txt fait foi pour les libellés téléchargeables.
  for (const line of readFileSync(path.join(BP3D_DIR, 'parts_list_e.txt'), 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [id, en] = line.split('\t');
    if (id && en) nameOf.set(id.replace(/"/g, ''), en.trim());
  }
  return { children, nameOf };
}

export const stlPath = (id) => path.join(BP3D_DIR, 'stl', `${id}.stl`);
export const hasMesh = (id) => existsSync(stlPath(id));
export const triangleCount = (id) => {
  try { return readFileSync(stlPath(id)).readUInt32LE(80); } catch { return 0; }
};

function descendants(children, rootId) {
  const seen = new Set();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const c of children.get(cur) ?? []) if (!seen.has(c)) stack.push(c);
  }
  seen.delete(rootId);
  return seen;
}

/** Décompose un libellé anglais en { side, qualifiers[], base }. */
function parseLabel(en) {
  let rest = en;
  const quals = [];
  let matched = true;
  while (matched) {
    matched = false;
    for (const q of QUALIFIERS) {
      if (q.en.test(rest)) { quals.push(q); rest = rest.replace(q.en, ''); matched = true; }
    }
    const side = /^(left|right) /.exec(rest);
    if (side && !TERMS[rest]) { /* le côté est retiré plus bas */ }
  }
  let side = null;
  const m = /^(left|right) /.exec(rest);
  if (m && !TERMS[rest]) { side = m[1]; rest = rest.replace(/^(left|right) /, ''); }
  return { side, quals, base: rest };
}

/** Dents : « right upper first secondary molar tooth » → { fdi: 16, fr, la }. */
function parseTooth(en) {
  const m = /^(left|right) (upper|lower) (.+) tooth$/.exec(en);
  if (!m) return null;
  const [, side, level, kindRaw] = m;
  const kind = TOOTH_KINDS[kindRaw];
  if (!kind) return null;
  const quadrant = FDI_QUADRANT[`${level}-${side}`];
  if (!quadrant) return null;
  const fdi = quadrant * 10 + kind.pos;
  const sideFr = side === 'left' ? 'gauche' : 'droite';
  const levelFr = level === 'upper' ? 'supérieure' : 'inférieure';
  return {
    fdi,
    fr: `${kind.fr} ${levelFr} ${sideFr} (${fdi})`,
    la: TOOTH_LATIN[kind.fr] ?? null,
  };
}

/** Identifiant stable, lisible et sans accent, dérivé du nom français. */
function slugify(fr) {
  return fr.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function buildCatalog() {
  const { children, nameOf } = loadBp3d();
  const idOf = (label) => [...nameOf.entries()].find(([, v]) => v === label)?.[0];

  const headId = idOf('head');
  const neckId = idOf('neck');
  if (!headId || !neckId) throw new Error('Racines « head » / « neck » introuvables dans l’arbre BodyParts3D.');

  const selected = new Set([...descendants(children, headId), ...descendants(children, neckId)]);
  for (const id of EXTRA_IDS) {
    if (!hasMesh(id)) throw new Error(`EXTRA_IDS : ${id} n'a pas de maillage dans la source.`);
    selected.add(id);
  }

  const brainId = idOf('brain');
  const brainSet = brainId ? descendants(children, brainId) : new Set();

  const entries = [];
  const missing = [];

  for (const fmaId of [...selected].filter(hasMesh)) {
    const en = nameOf.get(fmaId);
    if (!en) { missing.push(`${fmaId} (aucun libellé)`); continue; }

    const tooth = parseTooth(en);
    if (tooth) {
      entries.push({
        id: `dent_${tooth.fdi}`,
        name: tooth.fr,
        latinName: tooth.la,
        // Tissu minéralisé, affiché et basculé avec le squelette : c'est ce
        // qu'attend l'utilisateur en dentisterie (cocher « Squelette » doit
        // montrer les dents). La gencive, elle, reste un tissu mou.
        category: 'squelette',
        region: 'tete-et-cou',
        subregion: 'dents',
        fmaId,
        hasMesh: true,
        fdi: tooth.fdi,
        triangles: triangleCount(fmaId),
        sourceLabel: en,
      });
      continue;
    }

    const { side, quals, base } = parseLabel(en);
    const term = TERMS[base];
    if (!term) { missing.push(`${fmaId}  «${en}»  (terme de base : «${base}»)`); continue; }

    let name = term.fr;
    for (const q of quals) name = q.fr(name);
    name = withSide(name, term.g, side);

    entries.push({
      id: slugify(name),
      name,
      latinName: term.la,
      category: term.sys,
      region: 'tete-et-cou',
      subregion: brainSet.has(fmaId) ? 'encephale' : term.sub,
      fmaId,
      hasMesh: true,
      triangles: triangleCount(fmaId),
      sourceLabel: en,
    });
  }

  if (missing.length) {
    throw new Error(
      `${missing.length} structure(s) sans entrée de nomenclature dans naming.mjs :\n  ` +
      missing.join('\n  ') +
      `\n\nAjoute-les à TERMS plutôt que de les ignorer : une structure présente dans les ` +
      `données doit être nommée, pas écartée en silence.`,
    );
  }

  // Doublons d'identifiant : révèlent une collision de nommage, à corriger.
  const byId = new Map();
  for (const e of entries) {
    if (byId.has(e.id)) throw new Error(`Identifiant en double : « ${e.id} » (${byId.get(e.id).sourceLabel} / ${e.sourceLabel})`);
    byId.set(e.id, e);
  }

  entries.sort((a, b) => a.subregion.localeCompare(b.subregion) || a.name.localeCompare(b.name, 'fr'));
  return entries;
}

/**
 * Structures réelles connues mais SANS maillage dans le jeu de données —
 * conservées comme structures « cours » (recherchables, explicables par l'IA)
 * et affichées comme telles. Aucune géométrie n'est fabriquée pour elles.
 */
const COURSE_ONLY = [
  ['nerf_trijumeau', 'Nerf trijumeau (V)', 'Nervus trigeminus', 'nerfs', 'crane'],
  ['nerf_ophtalmique_v1', 'Nerf ophtalmique (V1)', 'Nervus ophthalmicus', 'nerfs', 'orbite'],
  ['nerf_maxillaire_v2', 'Nerf maxillaire (V2)', 'Nervus maxillaris', 'nerfs', 'face'],
  ['nerf_mandibulaire_v3', 'Nerf mandibulaire (V3)', 'Nervus mandibularis', 'nerfs', 'machoire'],
  ['nerf_alveolaire_inferieur', 'Nerf alvéolaire inférieur', 'Nervus alveolaris inferior', 'nerfs', 'machoire'],
  ['nerf_lingual', 'Nerf lingual', 'Nervus lingualis', 'nerfs', 'machoire'],
  ['nerf_infra_orbitaire', 'Nerf infra-orbitaire', 'Nervus infraorbitalis', 'nerfs', 'face'],
  ['nerf_facial', 'Nerf facial (VII)', 'Nervus facialis', 'nerfs', 'face'],
  ['nerf_hypoglosse', 'Nerf hypoglosse (XII)', 'Nervus hypoglossus', 'nerfs', 'cou'],
  ['nerf_massetérique', 'Nerf massétérique', 'Nervus massetericus', 'nerfs', 'machoire'],
  ['artere_carotide_externe', 'Artère carotide externe', 'Arteria carotis externa', 'vaisseaux', 'cou'],
  ['artere_carotide_interne', 'Artère carotide interne', 'Arteria carotis interna', 'vaisseaux', 'cou'],
  ['artere_maxillaire', 'Artère maxillaire', 'Arteria maxillaris', 'vaisseaux', 'machoire'],
  ['artere_faciale', 'Artère faciale', 'Arteria facialis', 'vaisseaux', 'face'],
  ['artere_linguale', 'Artère linguale', 'Arteria lingualis', 'vaisseaux', 'cou'],
  ['artere_alveolaire_inferieure', 'Artère alvéolaire inférieure', 'Arteria alveolaris inferior', 'vaisseaux', 'machoire'],
  ['glande_parotide', 'Glande parotide', 'Glandula parotidea', 'organes', 'face'],
  ['glande_submandibulaire', 'Glande submandibulaire', 'Glandula submandibularis', 'organes', 'machoire'],
  ['glande_sublinguale', 'Glande sublinguale', 'Glandula sublingualis', 'organes', 'machoire'],
  ['langue', 'Langue', 'Lingua', 'organes', 'machoire'],
  ['articulation_temporo_mandibulaire', 'Articulation temporo-mandibulaire (ATM)', 'Articulatio temporomandibularis', 'squelette', 'machoire'],
  ['ligament_parodontal', 'Ligament parodontal', 'Periodontium', 'organes', 'dents'],
  ['email_dentaire', 'Émail dentaire', 'Enamelum', 'organes', 'dents'],
  ['dentine', 'Dentine', 'Dentinum', 'organes', 'dents'],
  ['pulpe_dentaire', 'Pulpe dentaire', 'Pulpa dentis', 'organes', 'dents'],
  ['os_alveolaire', 'Os alvéolaire', 'Processus alveolaris', 'squelette', 'dents'],
  ['sinus_maxillaire', 'Sinus maxillaire', 'Sinus maxillaris', 'organes', 'face'],
];

export function courseOnlyEntries() {
  return COURSE_ONLY.map(([id, name, latinName, category, subregion]) => ({
    id, name, latinName, category, region: 'tete-et-cou', subregion,
    fmaId: null, hasMesh: false, triangles: 0, sourceLabel: null,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const meshed = buildCatalog();
  const all = [...meshed, ...courseOnlyEntries()];
  writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);

  const bySub = {};
  let tri = 0;
  for (const e of meshed) {
    bySub[e.subregion] ??= { n: 0, tri: 0 };
    bySub[e.subregion].n++;
    bySub[e.subregion].tri += e.triangles;
    tri += e.triangles;
  }
  console.log(`Catalogue écrit : ${OUT}`);
  console.log(`  ${meshed.length} structures avec maillage réel (${tri.toLocaleString('fr-FR')} triangles)`);
  console.log(`  ${all.length - meshed.length} structures « cours » (aucun maillage dans la source)`);
  for (const [sub, s] of Object.entries(bySub).sort()) {
    console.log(`    ${sub.padEnd(12)} ${String(s.n).padStart(3)} structures  ${s.tri.toLocaleString('fr-FR').padStart(11)} tri`);
  }
}
