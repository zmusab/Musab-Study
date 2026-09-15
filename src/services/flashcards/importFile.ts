/**
 * IMPORT DE CARTES DEPUIS UN FICHIER — Anki et Quizlet exportent tous les deux
 * du texte délimité, et c'est le seul pont universel entre eux.
 *
 * Ce module est PUR : il prend le contenu d'un fichier et rend des lignes
 * exploitables plus la liste de celles qu'il a refusées, avec leur numéro et
 * la raison. Rien n'est écrit ici, rien n'est deviné en silence — une ligne
 * que le parseur ne comprend pas est RAPPORTÉE, jamais transformée en carte
 * approximative, ni ignorée sans le dire.
 *
 * Trois formats réels sont visés :
 *  - l'export texte d'Anki : tabulations, précédé de lignes de directives
 *    « #separator:tab », « #html:true », et souvent du HTML dans les champs ;
 *  - l'export de Quizlet : séparateur choisi par l'utilisateur, en pratique
 *    tabulation ou virgule, un enregistrement par ligne ;
 *  - un simple CSV fait à la main dans un tableur, guillemets compris.
 */

export interface ImportedCard {
  question: string;
  answer: string;
  /** Ligne du fichier d'où elle vient, à partir de 1 — pour pouvoir la retrouver. */
  line: number;
}

export interface RejectedRow {
  line: number;
  text: string;
  reason: string;
}

export interface ImportPreview {
  cards: ImportedCard[];
  rejected: RejectedRow[];
  /** Séparateur retenu, affiché à l'utilisateur pour qu'il puisse vérifier. */
  delimiter: 'tabulation' | 'point-virgule' | 'virgule';
  /** Vrai si la première ligne a été reconnue comme un en-tête et écartée. */
  headerSkipped: boolean;
}

const DELIMITERS = { '\t': 'tabulation', ';': 'point-virgule', ',': 'virgule' } as const;
type DelimiterChar = keyof typeof DELIMITERS;

/** Directive d'Anki en tête de fichier : « #separator:tab », « #separator:; ». */
const SEPARATOR_DIRECTIVE = /^#separator:\s*(.+)$/i;

const DIRECTIVE_NAMES: Record<string, DelimiterChar> = {
  tab: '\t',
  tabulation: '\t',
  '\t': '\t',
  semicolon: ';',
  ';': ';',
  comma: ',',
  ',': ',',
};

/**
 * En-têtes reconnus, dans les deux langues et les deux applications. Une
 * première ligne « Question ; Réponse » est un en-tête ; « Combien de racines
 * a la 46 ? ; Deux » n'en est pas un, et doit devenir une carte.
 */
const HEADER_WORDS = new Set([
  'question',
  'questions',
  'réponse',
  'reponse',
  'réponses',
  'reponses',
  'answer',
  'answers',
  'front',
  'back',
  'recto',
  'verso',
  'term',
  'terme',
  'definition',
  'définition',
]);

/**
 * Découpe UNE ligne logique selon les règles CSV usuelles : un champ entre
 * guillemets peut contenir le séparateur, des sauts de ligne, et `""` pour un
 * guillemet littéral. Écrire ce découpage à la main plutôt que de couper sur
 * le séparateur est la différence entre importer « Deux (mésiale, distale) »
 * et importer deux champs cassés.
 */
function splitRecords(text: string, delimiter: DelimiterChar): string[][] {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    records.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char !== '\r') {
      field += char;
    }
  }
  // Dernière ligne sans saut de ligne final : elle compte comme les autres.
  if (field.length > 0 || row.length > 0) endRow();

  return records;
}

/**
 * Anki exporte du HTML dans ses champs quand la note en contenait. Laisser
 * `Deux racines<br>mésiale et distale` tel quel afficherait la balise à
 * l'écran ; on la rend donc lisible. Seules les balises de mise en forme
 * simples sont traitées — aucune tentative d'interpréter du HTML arbitraire,
 * ce qui serait à la fois inutile ici et une mauvaise idée.
 */
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

export function plainText(value: string): string {
  let out = value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li)>/gi, '\n');
  out = out.replace(/<[^>]+>/g, '');
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    out = out.split(entity).join(char);
  }
  // Les sauts de ligne introduits ci-dessus peuvent s'accumuler.
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Séparateur retenu : celui qui produit le plus de lignes à DEUX CHAMPS OU
 * PLUS, pas celui qui apparaît le plus souvent. Une réponse de cours contient
 * facilement plus de virgules que le fichier n'a de colonnes — compter les
 * occurrences aurait donc élu la virgule sur un fichier à tabulations.
 */
function detectDelimiter(lines: string[]): DelimiterChar {
  let best: DelimiterChar = '\t';
  let bestScore = -1;
  for (const candidate of Object.keys(DELIMITERS) as DelimiterChar[]) {
    const score = lines.filter((line) => (splitRecords(line, candidate)[0]?.length ?? 0) >= 2).length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function looksLikeHeader(row: string[]): boolean {
  const cells = row.slice(0, 2).map((cell) => plainText(cell).toLowerCase().replace(/[:*]/g, '').trim());
  return cells.length >= 2 && cells.every((cell) => HEADER_WORDS.has(cell));
}

export function parseCardFile(text: string): ImportPreview {
  // Les directives d'Anki sont retirées AVANT tout, mais on garde le décalage
  // de numérotation : une ligne rejetée doit pointer vers la bonne ligne du
  // fichier tel que l'utilisateur l'ouvrira.
  const rawLines = text.split(/\r?\n/);
  let declared: DelimiterChar | null = null;
  let firstDataLine = 0;
  for (const line of rawLines) {
    if (!line.startsWith('#')) break;
    const match = SEPARATOR_DIRECTIVE.exec(line.trim());
    if (match) declared = DIRECTIVE_NAMES[match[1]!.trim().toLowerCase()] ?? null;
    firstDataLine += 1;
  }

  const body = rawLines.slice(firstDataLine).join('\n');
  const candidates = rawLines.slice(firstDataLine).filter((line) => line.trim().length > 0);
  const delimiter = declared ?? detectDelimiter(candidates);

  const records = splitRecords(body, delimiter);
  const cards: ImportedCard[] = [];
  const rejected: RejectedRow[] = [];
  let headerSkipped = false;
  // « Première ligne » = la première ligne NON VIDE : un fichier qui commence
  // par une ligne blanche a toujours son en-tête, et le sauter reviendrait à
  // importer « Question / Réponse » comme une carte.
  let seenData = false;

  records.forEach((row, index) => {
    const line = firstDataLine + index + 1;
    const joined = row.join(delimiter);
    if (joined.trim().length === 0) return; // ligne vide : ni carte, ni rejet

    if (!seenData && looksLikeHeader(row)) {
      seenData = true;
      headerSkipped = true;
      return;
    }
    seenData = true;

    if (row.length < 2) {
      rejected.push({ line, text: joined.trim(), reason: 'une seule colonne : la réponse manque' });
      return;
    }

    const question = plainText(row[0]!);
    const answer = plainText(row[1]!);
    if (question.length === 0) {
      rejected.push({ line, text: joined.trim(), reason: 'question vide' });
      return;
    }
    if (answer.length === 0) {
      rejected.push({ line, text: joined.trim(), reason: 'réponse vide' });
      return;
    }

    cards.push({ question, answer, line });
  });

  return { cards, rejected, delimiter: DELIMITERS[delimiter], headerSkipped };
}

/**
 * L'EXPORT — le retour de l'import, et la garantie qu'il n'y a pas
 * d'enfermement : ce qui est entré peut ressortir, dans un format que Anki et
 * Quizlet relisent tous les deux.
 *
 * Le séparateur est la TABULATION, comme Anki : c'est le seul caractère qui
 * n'apparaît pratiquement jamais dans une réponse de cours, donc celui qui
 * demande le moins d'échappement. Les champs qui en contiennent quand même,
 * ou qui contiennent un guillemet ou un saut de ligne, sont mis entre
 * guillemets selon la règle CSV — celle-là même que `parseCardFile` relit.
 */
const needsQuoting = (value: string): boolean => /[\t"\n\r]/.test(value);

const csvField = (value: string): string =>
  needsQuoting(value) ? `"${value.split('"').join('""')}"` : value;

export function toCardFile(cards: readonly { question: string; answer: string }[]): string {
  // La directive en tête rend le fichier relisible sans deviner, par Anki
  // comme par `parseCardFile`.
  const lines = ['#separator:tab', '#html:false'];
  for (const card of cards) {
    lines.push(`${csvField(card.question)}\t${csvField(card.answer)}`);
  }
  return `${lines.join('\n')}\n`;
}
