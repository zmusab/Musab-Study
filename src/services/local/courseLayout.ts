/**
 * REMISE EN FORME D'UN COURS EXTRAIT D'UN PDF.
 *
 * ── LE CONSTAT QUI A RENDU CE FICHIER NÉCESSAIRE ──────────────────────────
 * Mesuré sur un vrai cours de l'utilisateur (10 pages, 15 600 caractères,
 * « Divisions du nerf trijumeau ») : le moteur local en tirait QUATORZE faits,
 * et répondait à ZÉRO question sur huit — y compris « nerf trijumeau », alors
 * que c'est le titre du document.
 *
 * La cause n'était ni les règles, ni le classement : c'était la FORME du
 * texte. Un PDF de cours est une arborescence — un titre, ses puces, ses
 * sous-puces — mais `getTextContent()` de pdf.js rend une page comme une seule
 * ligne continue, tous les items joints par des espaces. Toute la structure
 * hiérarchique existe encore dans le texte (les caractères de puce sont là),
 * mais plus une seule fin de ligne : les détections qui travaillent ligne par
 * ligne (`isBulletLine`, `detectBulletEnumerations`) ne voyaient donc RIEN.
 *
 * Trois défauts, dans l'ordre de gravité mesurée :
 *
 *  1. AUCUN RETOUR À LA LIGNE. Une page = une ligne de 2 000 caractères.
 *  2. MARQUEURS INCONNUS. `BULLET_PREFIX` reconnaissait « - • * ▪ ‣ ». Le
 *     cours utilise « § » (31 fois), « → » (14), « o », et des puces
 *     numérotées cerclées (❶…❺). Les deux marqueurs les plus fréquents du
 *     document n'étaient pas des puces pour l'application.
 *  3. EN-TÊTE COURANT répété sur chaque page (« A NATOMIE ¾ - D IVISIONS DU
 *     N ERF T RIJUMEAU 3 »), qui devenait une « phrase » à analyser.
 *
 * Ce module répare la forme SANS TOUCHER AUX MOTS. Il n'ajoute, ne retire et
 * ne corrige aucun contenu : il replace des fins de ligne là où le PDF avait
 * des puces, normalise les marqueurs, et retire les en-têtes courants qui se
 * répètent à l'identique. Un extrait reste vérifiable mot pour mot dans le
 * document d'origine.
 */

/**
 * Marqueurs de puce rencontrés dans de vrais polycopiés. Chacun ouvre un
 * élément de liste ; le niveau est déduit du marqueur, comme dans le document
 * d'origine (« • » niveau 1, « § » et « o » niveau 2).
 */
const BULLET_MARKERS = '•§▪‣◦▫※';
const ARROW_MARKERS = '→⇒➔►';
/** Puces numérotées cerclées : ❶❷❸❹❺❻❼❽❾ et ⓐⓑⓒ. */
const CIRCLED = '❶-❿ⓐ-ⓙ①-⑩';

/**
 * Un « o » n'est une puce que s'il est ISOLÉ entre deux espaces et suivi d'une
 * majuscule : « o Une partie qui réalise… ». Sans ces deux conditions, on
 * couperait au milieu de « … o rbitaire » ou de n'importe quel mot d'une
 * lettre.
 */
const LONE_O_BULLET = /\s+o\s+(?=[A-ZÀ-Þ])/g;

/**
 * PUCES DE POLICE SYMBOLE.
 *
 * Un polycopié composé sous Word utilise couramment Wingdings ou Symbol pour
 * ses puces. pdf.js ne connaît pas ces polices : il rend le glyphe par le
 * caractère ASCII qui occupe la même position dans la table, d'où des « ! »,
 * « " » et « # » là où le document affiche des losanges. Mesuré sur un vrai
 * cours : les trois sections « Nerf naso-ciliaire », « Nerf frontal » et
 * « Nerf lacrymal » commencent toutes par l'un de ces caractères — et la
 * question « nerf frontal » ne trouvait rien, faute de voir le début de sa
 * section.
 *
 * La condition est stricte et c'est ce qui la rend sûre : le symbole doit être
 * SEUL entre deux espaces ET suivi d'une majuscule. En français, aucun de ces
 * caractères ne s'emploie ainsi — un « ! » se colle au mot qui le précède, un
 * guillemet droit à celui qu'il ouvre. Un symbole isolé au milieu d'une ligne
 * ne peut être qu'un reste de puce.
 *
 * `^` autant que l'espace : une fois l'en-tête courant retiré, la puce se
 * retrouve au TOUT DÉBUT de la page. Exiger un espace avant elle laissait donc
 * passer précisément les sections qui ouvrent une page — dont « Nerf frontal »,
 * la section que la mesure signalait comme introuvable.
 */
const SYMBOL_BULLET = /(?:^|\s)[!"#$%&*+]\s+(?=[A-ZÀ-Þ])/gm;

/**
 * ACCENTS DÉTACHÉS.
 *
 * Certains PDF placent la lettre et son accent comme deux glyphes distincts,
 * positionnés l'un sur l'autre. À l'extraction, l'accent devient un caractère
 * combinant séparé et la lettre se retrouve isolée entre deux espaces :
 * « sph é no-palatin », « grand p é treux », « au nive au du pont ».
 *
 * Conséquence concrète : pour l'index, « sphéno » n'existe pas — il y a
 * « sph », « é » et « no ». Une question sur le ganglion sphéno-palatin ne
 * pouvait donc rien retrouver.
 *
 * On recolle une lettre isolée porteuse d'un accent combinant entre deux
 * fragments de mot. Le motif exige des lettres de part et d'autre : il ne
 * touche jamais à un mot d'une lettre légitime (« a », « y »), qui n'est
 * jamais accentué de cette façon.
 *
 * Les plages combinantes sont écrites en \u : un intervalle de diacritiques
 * saisi littéralement est invisible dans un éditeur et se confond avec le
 * caractère précédent.
 */
const DETACHED_ACCENT = /([a-zà-ÿ]) ([a-z][\u0300-\u036f]) ?([a-zà-ÿ])/gi;

/**
 * Même corruption, autre encodage : l'accent est déjà FUSIONNÉ à sa lettre
 * (« é » en un seul caractère), mais la lettre reste isolée entre deux
 * fragments de mot — « naso-sup é rieurs », « ganglion sph é no-palatin ».
 *
 * La lettre du milieu est restreinte aux voyelles accentuées qui ne forment
 * JAMAIS un mot français à elles seules. « à », « ù » et « y » en sont donc
 * exclus : « à » est une préposition courante, et les recoller casserait des
 * phrases correctes.
 */
const DETACHED_PRECOMPOSED = /([a-zà-ÿ]) ([éèêëîïôöûüçÉÈÊËÎÏÔÖÛÜÇ]) ?([a-zà-ÿ])/g;

/** Caractères de contrôle C1, résidus d'encodage sans aucun sens textuel. */
const CONTROL_CHARS = /[\u0080-\u009f]/g;

/**
 * DÉBUT DE PHRASE PERDU.
 *
 * Après remise en place des puces, il reste des lignes comme :
 *
 *     • Nerf frontal Il entre dans l'orbite par la fissure orbitaire…
 *
 * Le titre de section et la première phrase sont collés, parce que ce qui les
 * séparait dans le document était un retour à la ligne — que l'extraction a
 * remplacé par une espace. Tant qu'ils restent sur la même ligne, le titre
 * n'est pas un titre : il est avalé dans la phrase, et la section entière
 * devient introuvable (mesuré : la question « nerf frontal » ne renvoyait
 * rien alors que le cours lui consacre une page).
 *
 * Le signal utilisé est fiable : un mot en MINUSCULES suivi d'un pronom ou
 * d'un adverbe de reprise en MAJUSCULE. En français, « Il », « Cette »,
 * « Ensuite » ne portent la majuscule qu'en début de phrase — au milieu d'une
 * proposition ils s'écrivent en minuscules. Une majuscule à cet endroit ne
 * peut donc être qu'une frontière de phrase effacée.
 *
 * Volontairement limité à des mots-outils sans ambiguïté : « Le », « La » ou
 * « Des » en sont exclus, parce qu'ils commencent aussi des noms propres
 * (« fracture de Le Fort ») et couperaient au mauvais endroit.
 */
const SENTENCE_RESTART =
  /([a-zà-ÿ0-9)\]]) (?=(?:Il|Elle|Ils|Elles|On|Ce|Cet|Cette|Ces|Ceci|Cela|Puis|Ensuite|Enfin|Ainsi|Chaque|PS)\b)/g;

/**
 * Segments répétés à l'identique sur plusieurs pages : en-tête ou pied de
 * page. Trois occurrences suffisent — deux pourraient être une répétition
 * légitime du cours.
 */
const MIN_RUNNING_HEADER_REPEATS = 3;

/**
 * Recolle les termes composés que l'extraction espace : « naso - ciliaire »
 * devient « naso-ciliaire ».
 *
 * Le trait d'union entouré d'espaces vient du crénage du PDF, pas de l'auteur.
 * Sans ce recollage, une question sur « le nerf naso-ciliaire » ne retrouve
 * jamais « naso - ciliaire » dans le cours : ce sont, pour l'index, trois
 * jetons sans rapport.
 *
 * La condition est stricte — lettre, espaces, trait d'union, espaces, lettre
 * MINUSCULE — pour ne pas toucher aux tirets de ponctuation, qui sont suivis
 * d'une majuscule ou d'un mot entier (« Anatomie ¾ - Divisions du nerf »).
 */
function joinHyphenatedTerms(text: string): string {
  return text.replace(/([a-zà-ÿ]) +- +([a-zà-ÿ])/g, '$1-$2');
}

/**
 * Retire l'en-tête courant : le PRÉFIXE COMMUN le plus long que partagent au
 * moins trois pages, une fois les chiffres neutralisés.
 *
 * Une première version comparait les 80 premiers caractères de chaque page.
 * Elle ne trouvait rien : sur un PDF aplati, l'en-tête est suivi, SUR LA MÊME
 * LIGNE, du début du contenu de la page — qui diffère à chaque fois. Deux
 * pages ne partagent donc jamais leurs 80 premiers caractères, alors qu'elles
 * partagent bien leurs 45 premiers. Il fallait mesurer la longueur commune au
 * lieu de la supposer.
 *
 * Les chiffres sont neutralisés pour la COMPARAISON seulement : c'est le
 * numéro de page qui, sinon, ferait diverger deux en-têtes identiques.
 */
export function stripRunningHeaders(pages: readonly string[]): string[] {
  if (pages.length < MIN_RUNNING_HEADER_REPEATS) return [...pages];

  /*
    Le numéro de page est masqué comme un TOUT, pas chiffre par chiffre.
    Avec un masque par chiffre, « … TRIJUMEAU 9 » donnait « … TRIJUMEAU # »
    et « … TRIJUMEAU 10 » donnait « … TRIJUMEAU ## » : le préfixe commun
    s'arrêtait avant la fin de l'en-tête, et la page 10 — la seule à deux
    chiffres — gardait son en-tête entier. Mesuré sur un vrai cours :
    l'assistant répondait « combien de branches a le nerf trijumeau ? » en
    citant « ANATOMIE ¾ - DIVISIONS DU NERF TRIJUMEAU » comme un titre de
    section, puis « 10 » comme un fait.

    Le masque est un caractère nul, jamais présent dans un texte extrait —
    contrairement à « # », qui peut appartenir au cours.
  */
  const masked = pages.map((page) => page.replace(DIGIT_RUN, DIGIT_MASK));

  // Longueur du préfixe commun à toutes les pages sauf, éventuellement, les
  // premières (page de garde) — d'où la comparaison sur la majorité.
  const reference = masked[1] ?? masked[0]!;
  let common = 0;
  for (let length = 1; length <= Math.min(reference.length, 120); length += 1) {
    const prefix = reference.slice(0, length);
    const shared = masked.filter((page) => page.startsWith(prefix)).length;
    if (shared < MIN_RUNNING_HEADER_REPEATS) break;
    common = length;
  }

  /*
    UN EN-TÊTE TIENT SUR UNE OU DEUX LIGNES — titre, puis numéro de page.
    Sans cette borne, des pages qui se ressemblent beaucoup (même gabarit,
    seul le numéro change) partagent un préfixe long de toute la page, et le
    retrait emporterait le contenu avec l'en-tête. On ramène donc le préfixe
    à la dernière frontière de ligne qu'il contient, au plus deux lignes.

    Quand il n'y a AUCUN retour à la ligne — le cas d'une page entièrement
    aplatie par l'extraction, celui pour lequel ce module existe — la borne ne
    s'applique pas : il n'y a pas de frontière où reculer.
  */
  let prefixText = reference.slice(0, common);
  const lastBreak = prefixText.lastIndexOf('\n');
  if (lastBreak >= 0) {
    const headerLines = prefixText.slice(0, lastBreak + 1).split('\n').slice(0, MAX_RUNNING_HEADER_LINES);
    prefixText = headerLines.join('\n') + '\n';
  }

  // Un préfixe commun trop court n'est pas un en-tête, c'est une coïncidence
  // (« Le », « La »). En dessous de douze caractères, on ne touche à rien.
  if (prefixText.length < 12) return [...pages];

  /*
    Le retrait se fait par MOTIF et non par longueur. Un nombre masqué occupe
    un caractère quel que soit son nombre de chiffres : couper `common`
    caractères du texte d'origine décalerait tout sur la page 10 et y
    laisserait un « 0 » collé au premier mot.
  */
  const pattern = new RegExp('^' + prefixText.split(DIGIT_MASK).map(escapeRegExp).join('\\d+'));

  return pages.map((page) => {
    const stripped = page.replace(pattern, '');
    return stripped === page ? page : stripped.trimStart();
  });
}

/** Titre, puis numéro de page : au-delà, ce n'est plus un en-tête. */
const MAX_RUNNING_HEADER_LINES = 2;

/** Nombre entier, masqué d'un seul tenant. */
const DIGIT_RUN = /\d+/g;
/** Caractère nul : il ne peut pas venir du texte, donc jamais de collision. */
const DIGIT_MASK = '\u0000';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rend sa structure de liste à chaque page aplatie par l'extraction, PAGE PAR
 * PAGE.
 *
 * Le découpage par page est conservé volontairement : `extractPdfText` calcule
 * les décalages de page à partir de la longueur de chaque page, et c'est ce
 * qui permet à une citation de dire « page 4 ». Renvoyer un seul bloc obligerait
 * à recalculer ces décalages, ou à les fausser.
 */
export function restoreCourseLayoutPages(pages: readonly string[]): string[] {
  return stripRunningHeaders(pages).map((page) => {
    // L'ordre compte : on répare les MOTS avant de découper en lignes, sinon
    // un accent détaché en fin de ligne n'a plus sa suite pour se recoller.
    let text = page.replace(CONTROL_CHARS, '');
    text = text.replace(DETACHED_ACCENT, '$1$2$3').normalize('NFC');
    text = text.replace(DETACHED_PRECOMPOSED, '$1$2$3');
    text = joinHyphenatedTerms(text);

    // Une fin de ligne AVANT chaque marqueur : c'est ce qui rend au document
    // les frontières que l'extraction avait effacées.
    text = text.replace(new RegExp(`\\s*([${BULLET_MARKERS}])\\s*`, 'g'), '\n$1 ');
    text = text.replace(new RegExp(`\\s*([${ARROW_MARKERS}])\\s*`, 'g'), '\n$1 ');
    text = text.replace(new RegExp(`\\s*([${CIRCLED}])\\s*`, 'g'), '\n$1 ');
    text = text.replace(LONE_O_BULLET, '\no ');
    /*
     * Le glyphe de police symbole est remplacé par un simple RETOUR À LA
     * LIGNE, sans marqueur : dans ce type de polycopié il ouvre une SECTION
     * (« Nerf frontal », « Nerf lacrymal »), pas un élément de liste. Lui
     * remettre une puce le ferait classer comme item, et `courseSections`
     * refuserait d'y voir un titre — la section resterait introuvable, ce qui
     * était précisément le symptôme de départ.
     */
    text = text.replace(SYMBOL_BULLET, '\n');
    // En dernier : les puces sont posées, il ne reste qu'à rouvrir les phrases
    // que l'aplatissement avait soudées à leur titre.
    text = text.replace(SENTENCE_RESTART, '$1\n');

    return text
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .filter((line) => !isPageArtefact(line))
      .join('\n');
  });
}

/**
 * NUMÉRO DE PAGE resté seul sur sa ligne.
 *
 * `stripRunningHeaders` retire l'en-tête répété (« ANATOMIE - LE NERF
 * TRIJUMEAU ») mais pas le numéro qui le suit : celui-ci se retrouve isolé et
 * devient une ligne de contenu comme une autre. L'assistant répondait alors
 * « combien de branches a le nerf trijumeau ? » en citant, en premier point,
 * « 10 » — le numéro de la page.
 *
 * Est retenue comme artefact une ligne qui ne contient QUE de quoi numéroter :
 * un nombre d'au plus trois chiffres, éventuellement précédé de « page » ou
 * accompagné d'un total (« 10/24 », « - 10 - »). Un nombre plus long ou
 * accompagné de la moindre lettre est du contenu — « 3 branches terminales »,
 * « 5mm », « V3 » ne sont jamais touchés.
 */
const PAGE_ARTEFACT = /^(?:page\s*)?[-–—\s]*\d{1,3}(?:\s*\/\s*\d{1,3})?[-–—\s.]*$/i;

function isPageArtefact(line: string): boolean {
  return PAGE_ARTEFACT.test(line.trim());
}

/** Même traitement, rendu en un seul texte — pratique pour mesurer et tester. */
export function restoreCourseLayout(pages: readonly string[]): string {
  return restoreCourseLayoutPages(pages)
    .filter((page) => page.length > 0)
    .join('\n\n');
}

/**
 * SECTIONS D'UN COURS — un titre et ce qui lui appartient.
 *
 * Une fois la mise en page rendue, un polycopié se lit comme une suite de
 * sections : « Nerf frontal », puis tout ce qui en parle jusqu'au titre
 * suivant. C'est l'unité que cherche un étudiant qui demande « explique-moi le
 * nerf frontal » — pas une ligne isolée.
 *
 * Une première version de la recherche de passages renvoyait des LIGNES. Sur
 * un texte remis en forme, les lignes deviennent courtes : « Le ganglion
 * sphéno-palatin » fait vingt-six caractères, et son contenu est à la ligne
 * suivante. Renvoyer le titre seul, c'est renvoyer une étiquette ; renvoyer la
 * ligne suivante seule, c'est renvoyer « Il est attaché sur le trajet du nerf
 * maxillaire » — une phrase dont on ne sait plus de quoi elle parle.
 */
export interface CourseSection {
  /** Titre de la section, ou `null` pour le texte qui précède tout titre. */
  heading: string | null;
  /** Lignes du corps, dans l'ordre, marqueurs de puce conservés. */
  lines: string[];
}

const SECTION_HEADING_MAX_CHARS = 70;

/**
 * Un titre est une ligne courte, sans ponctuation finale de phrase, qui n'est
 * pas elle-même un élément de liste. La dernière condition compte : dans une
 * énumération, « § Nerf frontal » est un ÉLÉMENT de la liste précédente, pas
 * l'ouverture d'une section — le confondre découperait chaque liste en autant
 * de sections vides.
 */
function isSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > SECTION_HEADING_MAX_CHARS) return false;
  if (/^[-•*▪‣§◦▫→⇒➔►]/u.test(trimmed)) return false;
  if (/^o\s+[A-ZÀ-Þ]/.test(trimmed)) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  // Un titre commence par une majuscule ou un article : « Le nerf frontal ».
  return /^[A-ZÀ-Þ]|^l['’]/u.test(trimmed);
}

/** Découpe un texte remis en forme en sections titre + corps. */
export function courseSections(text: string): CourseSection[] {
  const sections: CourseSection[] = [];
  let current: CourseSection = { heading: null, lines: [] };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;

    if (isSectionHeading(line)) {
      if (current.heading !== null || current.lines.length > 0) sections.push(current);
      current = { heading: line, lines: [] };
      continue;
    }
    current.lines.push(line);
  }

  if (current.heading !== null || current.lines.length > 0) sections.push(current);
  return sections;
}
