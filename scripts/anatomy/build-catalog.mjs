#!/usr/bin/env node
/**
 * Génère `src/data/anatomy/bodyCatalog.json` À PARTIR DES DONNÉES RÉELLES
 * BodyParts3D — corps entier, et non plus seulement Tête et Cou.
 *
 * PRINCIPE
 * --------
 * Tout est dérivé de l'arbre d'inclusion officiel (`conventional_part_of.txt`,
 * le même que l'onglet « Tree » du BP3D Viewer) :
 *   - la SOUS-RÉGION vient de la racine anatomique la plus spécifique qui
 *     contient la structure (voir `regionTree.mjs`) ;
 *   - le SYSTÈME vient de la racine de système qui la contient ;
 *   - seule la NOMENCLATURE française est fournie à la main (`naming.mjs`),
 *     parce que la source ne contient que des libellés anglais.
 *
 * Une structure sans maillage n'entre jamais au catalogue comme maillée, et
 * une structure présente dans les données mais absente de la nomenclature
 * FAIT ÉCHOUER la génération : impossible d'en perdre une en silence.
 *
 * Usage : node scripts/anatomy/build-catalog.mjs [--report-missing]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { QUALIFIERS, TERMS, DERIVED_RULES, TOOTH_KINDS, FDI_QUADRANT, TOOTH_LATIN, withSide } from './naming.mjs';
import { SUBREGION_ROOTS, FALLBACK_BY_LABEL, SYSTEM_ROOTS, EXTRA_SUBREGIONS } from './regionTree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const BP3D_DIR = path.resolve(
  REPO_ROOT, '..', 'kevin-mattheus-moerman', 'bodyparts3d', 'assets', 'BodyParts3D_data',
);
const OUT = path.join(REPO_ROOT, 'src', 'data', 'anatomy', 'bodyCatalog.json');

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
  for (const line of readFileSync(path.join(BP3D_DIR, 'parts_list_e.txt'), 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [id, en] = line.split('\t');
    if (id && en) nameOf.set(id.replace(/"/g, ''), en.trim());
  }
  return { children, nameOf };
}

export const hasMesh = (id) => existsSync(path.join(BP3D_DIR, 'stl', `${id}.stl`));
export const triangleCount = (id) => {
  try { return readFileSync(path.join(BP3D_DIR, 'stl', `${id}.stl`)).readUInt32LE(80); } catch { return 0; }
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

/**
 * Qualificatifs composables génériques : « <modificateur> part/head/belly of X ».
 * Les traiter par motif plutôt qu'un à un évite d'énumérer les dizaines de
 * combinaisons présentes dans la source.
 */
const GENERIC_QUALIFIER =
  /^(deep|superficial|anterior|posterior|superior|inferior|medial|lateral|upper|lower|long|short|oblique|transverse|descending|ascending|vertical|horizontal|abdominal|acromial|clavicular|sternocostal|costal|spinal|iliac|lumbar|thoracic|cervical|straight|first|second|third|fourth|fifth|sixth|seventh|external|internal|innermost|accessory|humeral|ulnar|radial|humeroulnar|tibial|fibular|femoral)\s+(part|head|belly|portion|limb|fibers|bundle|layer)\s+of\s+/i;

const QUALIFIER_FR = {
  deep: 'profond', superficial: 'superficiel', anterior: 'antérieur', posterior: 'postérieur',
  superior: 'supérieur', inferior: 'inférieur', medial: 'médial', lateral: 'latéral',
  upper: 'supérieur', lower: 'inférieur', long: 'long', short: 'court', oblique: 'oblique',
  transverse: 'transverse', descending: 'descendant', ascending: 'ascendant', vertical: 'vertical',
  horizontal: 'horizontal', abdominal: 'abdominal', acromial: 'acromial', clavicular: 'claviculaire',
  sternocostal: 'sterno-costal', costal: 'costal', spinal: 'spinal', iliac: 'iliaque',
  lumbar: 'lombaire', thoracic: 'thoracique', cervical: 'cervical', straight: 'droit',
  first: 'premier', second: 'deuxième', third: 'troisième', fourth: 'quatrième', fifth: 'cinquième',
  sixth: 'sixième', seventh: 'septième', external: 'externe', internal: 'interne',
  innermost: 'le plus interne', accessory: 'accessoire', humeral: 'huméral', ulnar: 'ulnaire',
  radial: 'radial', humeroulnar: 'huméro-ulnaire', tibial: 'tibial', fibular: 'fibulaire',
  femoral: 'fémoral',
};
const PART_FR = {
  part: 'partie', head: 'chef', belly: 'ventre', portion: 'portion', limb: 'bras',
  fibers: 'fibres', bundle: 'faisceau', layer: 'couche',
};

/** Décompose un libellé anglais en { side, notes[], base }. */
function parseLabel(en) {
  let rest = en;
  const notes = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const q of QUALIFIERS) {
      if (q.en.test(rest)) { notes.push(q.fr); rest = rest.replace(q.en, ''); changed = true; }
    }
    const generic = GENERIC_QUALIFIER.exec(rest);
    if (generic) {
      const mod = QUALIFIER_FR[generic[1].toLowerCase()] ?? generic[1].toLowerCase();
      const kind = PART_FR[generic[2].toLowerCase()] ?? generic[2].toLowerCase();
      notes.push((b) => `${b} (${kind} ${mod})`);
      rest = rest.replace(GENERIC_QUALIFIER, '');
      changed = true;
    }
    if (/^(left|right)\s+/i.test(rest) && !TERMS[rest]) {
      // le côté est extrait plus bas, une seule fois
    }
  }
  let side = null;
  // Côté en tête : « left masseter ».
  const leading = /^(left|right)\s+/i.exec(rest);
  if (leading && !TERMS[rest]) { side = leading[1].toLowerCase(); rest = rest.replace(/^(left|right)\s+/i, ''); }
  // Côté enchâssé : « abductor digiti minimi of left foot » — fréquent aux
  // membres. Sans cette règle, chaque muscle apparaîtrait deux fois comme
  // deux racines distinctes à nommer.
  const embedded = /\bof (left|right) (hand|foot|forearm|leg|arm|thigh|wrist|ankle|thumb|big toe|great toe|second toe|third toe|fourth toe|little toe|index finger|middle finger|ring finger|little finger)\b/i.exec(rest);
  if (embedded && !TERMS[rest]) {
    side = side ?? embedded[1].toLowerCase();
    rest = rest.replace(/\bof (left|right) /i, 'of ');
  }
  return { side, notes, base: rest.trim() };
}

function parseTooth(en) {
  const m = /^(left|right) (upper|lower) (.+) tooth$/.exec(en);
  if (!m) return null;
  const [, side, level, kindRaw] = m;
  const kind = TOOTH_KINDS[kindRaw];
  if (!kind) return null;
  const quadrant = FDI_QUADRANT[`${level}-${side}`];
  if (!quadrant) return null;
  const fdi = quadrant * 10 + kind.pos;
  return {
    fdi,
    fr: `${kind.fr} ${level === 'upper' ? 'supérieure' : 'inférieure'} ${side === 'left' ? 'gauche' : 'droite'} (${fdi})`,
    la: TOOTH_LATIN[kind.fr] ?? null,
  };
}

function slugify(fr) {
  return fr.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Sous-région → région de premier niveau, dérivée des déclarations ci-dessus. */
const REGION_OF = new Map([
  ...SUBREGION_ROOTS.map((s) => [s.id, s.region]),
  ...EXTRA_SUBREGIONS.map((s) => [s.id, s.region]),
]);

export function buildCatalog({ reportMissing = false } = {}) {
  const { children, nameOf } = loadBp3d();
  const idOf = (label) => [...nameOf.entries()].find(([, v]) => v === label)?.[0];

  // Ensembles de descendants, calculés une fois.
  const subregionSets = SUBREGION_ROOTS.map((meta) => {
    const rootId = idOf(meta.root);
    return { ...meta, members: rootId ? descendants(children, rootId) : new Set() };
  });
  const systemSets = SYSTEM_ROOTS.map((meta) => {
    const rootId = idOf(meta.root);
    return { ...meta, members: rootId ? descendants(children, rootId) : new Set() };
  });

  const allMeshed = [...new Set([...nameOf.keys()])].filter(hasMesh);

  const entries = [];
  const missing = new Map();

  for (const fmaId of allMeshed) {
    const en = nameOf.get(fmaId);
    if (!en) continue;

    // --- Système : première racine de système qui contient la structure.
    const system = systemSets.find((s) => s.members.has(fmaId))?.category ?? 'organes';

    // --- Sous-région : racine la plus spécifique (l'ordre du tableau fait foi),
    //     puis rattachement par libellé pour ce que l'arbre ne couvre pas.
    let subregion = subregionSets.find((s) => s.members.has(fmaId))?.id ?? null;
    if (!subregion) subregion = FALLBACK_BY_LABEL.find((f) => f.match.test(en))?.subregion ?? null;

    const tooth = parseTooth(en);
    if (tooth) {
      entries.push({
        id: `dent_${tooth.fdi}`,
        name: tooth.fr,
        latinName: tooth.la,
        category: 'squelette',
        subregion: 'dents',
        region: REGION_OF.get('dents') ?? null,
        fmaId,
        hasMesh: true,
        triangles: triangleCount(fmaId),
        sourceLabel: en,
        fdi: tooth.fdi,
      });
      continue;
    }

    const { side, notes, base } = parseLabel(en);
    // Motifs réguliers (côtes, vertèbres, métacarpiens, phalanges…) : une règle
    // dérivée plutôt qu'une entrée par numéro — même auditabilité, sans
    // centaines de lignes quasi identiques.
    const term = TERMS[base] ?? DERIVED_RULES.reduce((found, rule) => found ?? rule(base), null);
    if (!term) {
      if (!missing.has(base)) missing.set(base, en);
      continue;
    }

    let name = term.fr;
    for (const note of notes) name = note(name);
    name = withSide(name, term.g, side);

    // La mâchoire est une sous-division de la face côté source : on la
    // distingue explicitement, elle est centrale en dentisterie.
    if (term.sub === 'machoire') subregion = 'machoire';
    if (term.sub === 'dents') subregion = 'dents';
    if (!subregion) subregion = term.sub ?? null;

    entries.push({
      id: slugify(name),
      name,
      latinName: term.la ?? null,
      category: term.sys ?? system,
      subregion,
      region: subregion ? (REGION_OF.get(subregion) ?? null) : null,
      fmaId,
      hasMesh: true,
      triangles: triangleCount(fmaId),
      sourceLabel: en,
    });
  }

  if (reportMissing) return { entries, missing: [...missing.entries()] };

  if (missing.size) {
    const list = [...missing.entries()].map(([base, en]) => `  «${base}»  (ex. « ${en} »)`).join('\n');
    throw new Error(
      `${missing.size} racine(s) sans entrée dans naming.mjs :\n${list}\n\n` +
      `Ajoute-les à TERMS : une structure présente dans les données doit être nommée, pas écartée.`,
    );
  }

  // Identifiants uniques : une collision révèle deux structures qui
  // porteraient le même nom, donc indistinguables à l'écran.
  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.id)) {
      throw new Error(`Identifiant en double « ${e.id} » : ${seen.get(e.id)} / ${e.sourceLabel}`);
    }
    seen.set(e.id, e.sourceLabel);
  }

  entries.sort((a, b) => (a.subregion ?? '').localeCompare(b.subregion ?? '') || a.name.localeCompare(b.name, 'fr'));
  return { entries, missing: [] };
}

/**
 * Structures réelles connues mais SANS géométrie dans le jeu de données —
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
    id, name, latinName, category, subregion,
    region: REGION_OF.get(subregion) ?? null,
    fmaId: null, hasMesh: false, triangles: 0, sourceLabel: null,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reportMissing = process.argv.includes('--report-missing');
  const { entries, missing } = buildCatalog({ reportMissing });

  if (reportMissing) {
    console.log(`${missing.length} racines manquantes dans naming.mjs :\n`);
    for (const [base] of missing.sort((a, b) => a[0].localeCompare(b[0]))) console.log(base);
    process.exit(0);
  }

  const all = [...entries, ...courseOnlyEntries()];
  writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);

  const bySub = {};
  let tri = 0;
  for (const e of entries) {
    const key = e.subregion ?? '(non rattaché)';
    bySub[key] ??= { n: 0, tri: 0 };
    bySub[key].n++;
    bySub[key].tri += e.triangles;
    tri += e.triangles;
  }
  console.log(`Catalogue écrit : ${OUT}`);
  console.log(`  ${entries.length} structures avec maillage réel (${tri.toLocaleString('fr-FR')} triangles)`);
  console.log(`  ${all.length - entries.length} structures « cours » (aucune géométrie dans la source)`);
  for (const [sub, s] of Object.entries(bySub).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${sub.padEnd(18)} ${String(s.n).padStart(3)} structures ${s.tri.toLocaleString('fr-FR').padStart(12)} tri`);
  }
}
