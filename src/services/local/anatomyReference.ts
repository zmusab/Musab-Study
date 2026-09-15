import { BODY_CATALOG, type CatalogEntry } from '@/data/repositories/anatomy';
import { significantWords } from '@/core/text';
import { wordSimilarity } from '@/services/search/fuzzy';

/**
 * LA NOMENCLATURE DE RÉFÉRENCE, quand le cours ne dit rien.
 *
 * Jusqu'ici, une question portant sur un terme absent des documents importés
 * se terminait sur « Ce n'est pas dans tes cours ». C'est honnête, et c'est
 * une impasse : l'application connaît pourtant 961 structures anatomiques —
 * 305 pour la seule tête et le cou, dont 109 nerfs et les 28 dents
 * permanentes avec leur numérotation FDI — déjà présentes hors ligne pour la
 * vue 3D (`data/anatomy/bodyCatalog.json`, dérivé de BodyParts3D, voir
 * SOURCES.md).
 *
 * Répondre par cette base transforme une impasse en point de départ : le nom
 * latin exact, la catégorie, la région, et de quoi aller voir la structure en
 * 3D.
 *
 * ── CE QUE CE MODULE N'EST PAS ────────────────────────────────────────────
 * Ce n'est PAS du cours, et ça ne doit jamais en avoir l'air. C'est de la
 * NOMENCLATURE : un nom, une famille, une région. Elle ne dit rien du trajet,
 * des rapports, ni de ce que l'enseignant attend à l'examen — et c'est
 * précisément pour ça qu'elle est présentée à part, avec sa provenance, et
 * qu'elle ne s'affiche que lorsque le cours n'a rien à dire.
 *
 * Le jour où elle contredirait un cours, c'est le cours qui a raison : c'est
 * sur lui que l'étudiant est interrogé.
 */

export interface AnatomyReference {
  entry: CatalogEntry;
  /** Autres structures de la même famille, pour situer la première. */
  siblings: CatalogEntry[];
}

const CATEGORY_LABEL: Record<string, string> = {
  nerfs: 'nerf',
  muscles: 'muscle',
  squelette: 'os',
  vaisseaux: 'vaisseau',
  organes: 'organe',
};

const REGION_LABEL: Record<string, string> = {
  'tete-et-cou': 'tête et cou',
  tronc: 'tronc',
  'membre-superieur': 'membre supérieur',
  'membre-inferieur': 'membre inférieur',
  corps: 'corps entier',
};

/**
 * Part des mots de la question retrouvée dans le nom de la structure.
 *
 * Mesurée sur le NOM, pas sur la question : « nerf lingual » doit reconnaître
 * « Nerf lingual » entièrement, sans être pénalisé par les mots de politesse
 * ou de formulation que la question traîne autour.
 */
/**
 * Mots du NOM qu'on n'exige pas de la question.
 *
 * Le catalogue nomme ses structures des deux côtés (« Masséter droit »,
 * « Masséter gauche ») et numérote les dents (« Première molaire inférieure
 * droite (46) »). Exiger « droit » ou « 46 » dans la question faisait échouer
 * « le muscle masséter » et « la première molaire inférieure » — deux
 * formulations parfaitement normales, et les plus courantes.
 */
const SIDE_OR_NUMBER = /^(?:droit|droite|gauche|\d+)$/;

/**
 * …et ce qui est ENTRE PARENTHÈSES, pour la même raison : c'est une précision
 * que la question n'a aucune obligation de reprendre. « Masséter (faisceau
 * profond) droit » doit répondre à « le muscle masséter » ; « Nerf trijumeau
 * (V) » à « nerf trijumeau ».
 */
const PARENTHESIS = /\([^)]*\)/g;

function coverage(questionTerms: ReadonlySet<string>, name: string): number {
  const words = [...significantWords(name.replace(PARENTHESIS, ' '))].filter(
    (word) => !SIDE_OR_NUMBER.test(word),
  );
  if (words.length === 0) return 0;

  let matched = 0;
  for (const word of words) {
    if (questionTerms.has(word) || [...questionTerms].some((term) => sameTerm(term, word))) {
      matched += 1;
    }
  }
  return matched / words.length;
}

/**
 * MÊME TERME, ÉCRIT AUTREMENT — et rien de plus.
 *
 * Ici on ne cherche pas à rattraper les fautes de frappe : on accepte la
 * VARIATION MORPHOLOGIQUE, « lingual » / « linguale », « mandibule » /
 * « mandibulaire ». Le reste doit être refusé, parce qu'une nomenclature qui
 * répond à côté est pire qu'une nomenclature qui se tait : elle a l'air sûre
 * d'elle.
 *
 * ── POURQUOI PAS UN SIMPLE SEUIL DE SIMILARITÉ ────────────────────────────
 * Parce qu'il n'en existe aucun qui marche. Mesuré :
 *
 *     mentionne / mentonnier   0,700   à REJETER
 *     palais    / malaise      0,714   à REJETER
 *     orbitrale / orbitaire    0,667   à garder
 *
 * Les deux familles se chevauchent : tout seuil qui garde la troisième laisse
 * passer les deux premières. C'est ainsi que « Quels sont les territoires
 * différents mentionnés ? » recevait une fiche sur le muscle MENTONNIER.
 *
 * Ce qui les sépare vraiment est la longueur du PRÉFIXE COMMUN : quatre
 * lettres pour « ment|ionne » et « ment|onnier », huit pour « mandibul|e » et
 * « mandibul|aire ». Deux mots de la même famille partagent leur radical ;
 * deux mots qui se ressemblent par accident divergent tout de suite.
 *
 * Le prix, assumé : « masster » ne retrouve plus « masséter » ICI (préfixe
 * « mass », 4 lettres). La recherche du site, elle, continue de le faire —
 * elle propose, quand cette fiche-ci affirme.
 */
const MIN_SHARED_PREFIX = 5;
const MIN_SIMILARITY = 0.75;

function sharedPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

function sameTerm(a: string, b: string): boolean {
  return sharedPrefixLength(a, b) >= MIN_SHARED_PREFIX && wordSimilarity(a, b) >= MIN_SIMILARITY;
}

/**
 * Il faut que le nom soit reconnu ENTIÈREMENT, ou presque. En dessous, on
 * rapproche des structures qui partagent seulement un mot générique
 * (« nerf », « artère ») — c'est-à-dire n'importe laquelle.
 */
const MIN_COVERAGE = 0.99;
const MAX_SIBLINGS = 6;

/**
 * Structure de la nomenclature correspondant à la question, ou `null`.
 *
 * L'exigence est volontairement haute : mieux vaut ne rien proposer qu'un
 * « nerf facial » en réponse à une question sur le nerf lingual.
 */
/**
 * NUMÉROTATION FDI — la façon dont un étudiant en dentaire désigne une dent.
 *
 * « la 46 », « une 27 » : deux chiffres, le cadran puis le rang. C'est le
 * vocabulaire quotidien de la clinique, et aucun rapprochement par le NOM ne
 * pouvait le retrouver — « 46 » n'a rien de commun avec « première molaire
 * inférieure droite ».
 *
 * Les codes valides vont de 11 à 48, cadran par cadran : un nombre hors de
 * ces plages n'est pas une dent, c'est un nombre.
 */
function fdiInQuestion(question: string): number | null {
  for (const raw of question.match(/\b[1-4][1-8]\b/g) ?? []) {
    const code = Number(raw);
    if (BODY_CATALOG.some((entry) => entry.fdi === code)) return code;
  }
  return null;
}

export function findAnatomyReference(question: string): AnatomyReference | null {
  const terms = significantWords(question, true);
  if (terms.size === 0) return null;

  const fdi = fdiInQuestion(question);
  const byNumber = fdi === null ? null : BODY_CATALOG.find((entry) => entry.fdi === fdi);
  if (byNumber) return { entry: byNumber, siblings: siblingsOf(byNumber) };

  let best: CatalogEntry | null = null;
  let bestWords = 0;

  for (const entry of BODY_CATALOG) {
    if (coverage(terms, entry.name) < MIN_COVERAGE) continue;
    const words = significantWords(entry.name.replace(PARENTHESIS, ' ')).size;
    // À égalité de reconnaissance, le nom le PLUS précis gagne : « nerf
    // alvéolaire inférieur » plutôt que « nerf alvéolaire ».
    if (words > bestWords) {
      best = entry;
      bestWords = words;
    }
  }
  if (!best) return null;
  return { entry: best, siblings: siblingsOf(best) };
}

function siblingsOf(entry: CatalogEntry): CatalogEntry[] {
  return BODY_CATALOG.filter(
    (other) =>
      other.id !== entry.id &&
      other.category === entry.category &&
      other.subregion === entry.subregion,
  ).slice(0, MAX_SIBLINGS);
}

/** Rendu de la fiche, en disant clairement d'où elle vient. */
export function renderAnatomyReference(reference: AnatomyReference): string {
  const { entry, siblings } = reference;
  const kind = CATEGORY_LABEL[entry.category] ?? entry.category;
  const region = entry.region ? REGION_LABEL[entry.region] ?? entry.region : null;

  const lines = [`**${entry.name}** — nomenclature anatomique de référence.`, ''];

  const facts: string[] = [];
  if (entry.latinName) facts.push(`- Nom latin : **${entry.latinName}**`);
  facts.push(`- Type : ${kind}${region ? ` — région ${region}` : ''}`);
  if (typeof entry.fdi === 'number') facts.push(`- Numérotation FDI : **${entry.fdi}**`);
  if (entry.fmaId) facts.push(`- Référence FMA : ${entry.fmaId}`);
  lines.push(...facts);

  if (entry.hasMesh) {
    lines.push('', `Tu peux voir cette structure en 3D dans **Anatomie**.`);
  }

  if (siblings.length > 0) {
    lines.push('', '### Dans la même région', ...siblings.map((s) => `- ${s.name}`));
  }

  lines.push(
    '',
    '_Ceci vient de la nomenclature anatomique de l’application, PAS de tes cours : ' +
      'un nom, une famille, une région. Le trajet, les rapports et ce qui est attendu à ' +
      'l’examen sont dans ton cours — importe le document correspondant pour les obtenir._',
  );
  return lines.join('\n');
}
