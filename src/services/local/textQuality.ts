/**
 * Filtre qualité des extractions locales — le moteur à règles lit du texte
 * brut extrait d'un PDF, qui contient parfois des artefacts de mise en page
 * (numérotation de liste isolée « II », flèche de schéma « → », repère de
 * figure « C' »…). Sans ce filtre, ces artefacts peuvent se glisser dans le
 * SUJET ou la RÉPONSE d'un fait détecté et produire une carte du type
 * « Qu'est-ce que II ? » — vérifié comme un vrai cas d'usage signalé, pas
 * hypothétique.
 *
 * RÈGLE ABSOLUE : ce module ne répare JAMAIS un sujet/une réponse suspecte
 * en la complétant ou en la reformulant — il se contente de dire si le
 * fragment est exploitable ou non. Un sujet rejeté fait rejeter tout le
 * fait qui le porte (voir `relationExtraction.ts`) : mieux vaut une carte
 * de moins qu'une carte incompréhensible.
 */

const ROMAN_NUMERAL_ONLY = /^[ivxlcdm]+$/i;
const SINGLE_LETTER_LABEL = /^[a-z]['’]?$/i;

/**
 * Sujets ANAPHORIQUES — ils désignent quelque chose dit dans la phrase
 * PRÉCÉDENTE, qui n'existe plus une fois la carte isolée. « Son innervation
 * motrice est assurée par le nerf massétérique » donne une carte
 * « Qu'est-ce que Son innervation motrice ? » : l'étudiant n'a aucun moyen de
 * savoir de quoi on parle. Le sujet est donc rejeté, jamais complété — le
 * moteur n'a pas le droit de deviner l'antécédent.
 */
const ANAPHORIC_START =
  /^(?:il|elle|ils|elles|on|celui|celle|ceux|celles|cela|ça|ce|cet|cette|ces|son|sa|ses|leur|leurs|lui|y|en)\b/i;

/**
 * Un SUJET est un groupe nominal, jamais une proposition complète. Quand un
 * sujet contient l'un des verbes de relation, c'est que la capture a dérapé et
 * avalé toute la phrase : « Il se compose de deux faisceaux » comme sujet
 * produisait la carte « De quoi se compose Il se compose de deux faisceaux ? ».
 */
/*
 * `(?=$|[^\wà-ÿ])` et non `\b` À LA FIN.
 *
 * `\b` de JavaScript ne connaît que l'alphabet ASCII : après un « é », il ne
 * voit aucune frontière de mot. Un motif fermé par `\b` ne reconnaît donc
 * JAMAIS un verbe qui se termine par une lettre accentuée — « a attaché »,
 * « réalisé ». L'erreur est muette, et c'est ainsi que « Chaque branche du
 * nerf trijumeau a attaché sur son trajet un ganglion nerveux » passait pour
 * un groupe nominal.
 */
/**
 * LE GROUPE NOMINAL QUI PRÉCÈDE LE VERBE, quand la phrase en contient un.
 *
 * Rejeter tout bonnement une phrase parce qu'elle porte un verbe fait perdre
 * de vraies cartes : « Le nerf ophtalmique de Willis se divise en 3 branches
 * terminales : » NOMME son sujet, il est simplement suivi de son prédicat.
 *
 * On coupe donc au premier verbe et on valide ce qui précède. Si rien ne
 * précède, ou si ce qui précède n'est pas un sujet plausible, on s'abstient
 * comme avant — on ne bricole jamais un sujet qui n'est pas écrit.
 */
export function subjectBeforeVerb(sentence: string): string | null {
  const match = CLAUSE_VERB.exec(sentence);
  if (!match || match.index === 0) return null;
  const head = sentence.slice(0, match.index).trim().replace(/[,;:]$/, '').trim();
  return head.length > 0 && isPlausibleSubject(head) ? head : null;
}

const CLAUSE_VERB =
  /\b(?:se compose de|est composée? de|est constituée? de|comprend|poss[èe]de|comporte|présente|dispose de|désigne|correspond à|représente|permet|assure|commande|contrôle|se situe|se trouve|donne|change|réalise|chemine|entre dans|sort du|descend|se divise|se détache|s['’]unit|finit|innerve|transporte|reçoit|vient|a attaché|assurant)(?=$|[^\wà-ÿ])/i;

/**
 * LIGNE BRUTE PRISE POUR UN SUJET. Une puce résiduelle en tête, ou un
 * deux-points en fin : dans les deux cas la capture a ramassé une LIGNE du
 * document, pas le groupe nominal qu'elle contient.
 *
 * Mesuré : « De quoi se compose • Sur son trajet le nerf naso-ciliaire donne
 * 3 branches collatérales : ? ».
 *
 * Le deux-points final, lui, n'est PAS un motif de rejet : une annonce de
 * liste se termine légitimement par lui (« 4 muscles droits : »). Il est
 * retiré avant validation, là où le sujet est constitué.
 */
const RAW_LINE = /^[-•§▪‣◦▫→⇒➔►o]\s/;

/**
 * TITRE DE SECTION EN CAPITALES — « MOYEN », « ANTERIEUR », « POSTERIEUR ».
 * Le polycopié s'en sert pour découper une énumération ; seul sur une carte,
 * le mot ne nomme rien. Deux lettres suffisent à garder « V3 », « PS » ou
 * « FDI » hors de portée de cette règle, qui exige au moins trois lettres et
 * AUCUNE minuscule.
 */
const SHOUTED_LABEL = /^[A-ZÀ-Þ]{3,}$/;


/** Rien que des flèches/symboles de schéma et de la ponctuation — aucune lettre, aucun chiffre porteur de sens. */
const SYMBOLS_ONLY = /^[\s\-–—→←↔⇒⇔=>*•·.,;:()[\]{}'"’«»]*$/;

/*
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI SUIT VIENT D'UNE MESURE, PAS D'UNE INTUITION.
 *
 * 26 cartes générées depuis un vrai cours de l'utilisateur (« Divisions du
 * nerf trijumeau », 10 pages). SEIZE étaient inutilisables :
 *
 *     « Qu'est-ce que Ensuite, par une branche du nerf facial qui ? »
 *     « De quoi se compose (sensitives) : ? »
 *     « Où se situe (qui rappelons-le ? »
 *     « Qu'est-ce que Donc ce dernier ? »
 *     « De quoi se compose Remarque ? »
 *
 * Soixante pour cent de déchet. Un étudiant qui génère ses cartes et doit en
 * rejeter deux sur trois à la main n'utilise pas l'application : il la
 * referme. Chaque motif ci-dessous correspond à un de ces échecs constatés.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * CONNECTEUR EN TÊTE. « Et 2 muscles obliques », « Ensuite, par une
 * branche… », « Donc ce dernier » : le mot relie la phrase à la PRÉCÉDENTE.
 * Isolé sur une carte, il ne relie plus rien.
 */
const CONNECTOR_START =
  /^(?:et|ou|donc|or|mais|car|puis|ensuite|enfin|alors|ainsi|aussi|cependant|toutefois|néanmoins|également)(?=$|[^\wà-ÿ])/i;

/**
 * COMPLÉMENT CIRCONSTANCIEL EN TÊTE. « Dans son trajet le nerf ophtalmique »,
 * « Au niveau de l'orbite, le nerf maxillaire », « pour le septum nasal » :
 * la capture a commencé trop tôt et ramassé le complément avant le sujet. Ce
 * n'est pas un groupe nominal, c'est le décor de la phrase.
 */
const COMPLEMENT_START =
  /^(?:dans|sur|sous|vers|avec|sans|pour|par|chez|depuis|pendant|après|avant|entre|au niveau|à travers|au cours|lors)(?=$|[^\wà-ÿ])/i;

/**
 * RELATIF OU CONJONCTION PENDANTE EN FIN. « … du nerf facial qui », « … avec
 * le sinus maxillaire dont il », « (qui rappelons-le » : la capture s'est
 * arrêtée au milieu d'une proposition. La suite manquante est précisément ce
 * que la carte devrait demander.
 */
const DANGLING_END = /(?:^|[^\wà-ÿ])(?:qui|que|qu|dont|où|lequel|laquelle|lesquels|et|ou|de|du|des|à|au|aux|en|il|elle)\s*$/i;

/**
 * OUVERTURE SUR UNE PARENTHÈSE. « (sensitives) : », « (qui rappelons-le ». Un
 * groupe nominal ne commence jamais par une parenthèse : ce qu'elle précise
 * est resté en amont.
 */
const OPENS_ON_BRACKET = /^[([]/;

/**
 * ÉTIQUETTE DE DOCUMENT, pas sujet d'étude. « Remarque », « Schéma palais
 * dur : », « PS », « MOYEN », « ANTERIEUR » — le polycopié s'en sert pour
 * s'organiser, elles ne nomment aucune structure.
 */
const DOCUMENT_LABEL =
  /^(?:remarque|note|ps|nb|attention|schéma|schema|figure|fig|exemple|conclusion|introduction|définition|rappel|résumé|sommaire|plan)(?=$|[^\wà-ÿ])/i;

const stripLeadingArticle = (text: string): string =>
  text.replace(/^(?:l['’]|le\s+|la\s+|les\s+|un\s+|une\s+|des\s+|de\s+|du\s+)/i, '').trim();

/**
 * Un sujet est exploitable s'il contient au moins un vrai mot (suite de
 * lettres, accents compris, d'au moins 3 caractères) qui n'est pas
 * lui-même un chiffre romain isolé, et si les lettres dominent le texte
 * (pas un sujet majoritairement fait de chiffres/symboles).
 */
export function isPlausibleSubject(rawSubject: string): boolean {
  const trimmed = rawSubject.trim();
  // Testés sur le sujet BRUT : un article en tête est anodin et peut être
  // retiré, un pronom ou un verbe ne le sont pas.
  if (ANAPHORIC_START.test(trimmed)) return false;
  if (CLAUSE_VERB.test(trimmed)) return false;
  if (CONNECTOR_START.test(trimmed)) return false;
  if (COMPLEMENT_START.test(trimmed)) return false;
  if (DANGLING_END.test(trimmed)) return false;
  if (OPENS_ON_BRACKET.test(trimmed)) return false;
  if (DOCUMENT_LABEL.test(trimmed)) return false;
  if (RAW_LINE.test(trimmed)) return false;
  if (SHOUTED_LABEL.test(trimmed)) return false;

  const subject = stripLeadingArticle(trimmed);
  if (subject.length === 0) return false;
  if (subject.length > 80) return false; // un « sujet » de deux lignes est une capture ratée, pas un terme.
  if (SYMBOLS_ONLY.test(subject)) return false;
  if (ROMAN_NUMERAL_ONLY.test(subject)) return false;
  if (SINGLE_LETTER_LABEL.test(subject)) return false;

  const words = subject.match(/[a-zà-ÿ]+/gi) ?? [];
  const hasRealWord = words.some((word) => word.length >= 3 && !ROMAN_NUMERAL_ONLY.test(word));
  if (!hasRealWord) return false;

  const letterCount = (subject.match(/[a-zà-ÿ]/gi) ?? []).length;
  return letterCount / subject.length >= 0.5;
}

/**
 * Une réponse est exploitable si elle porte au moins un vrai mot — sinon
 * elle ne permettrait de répondre à la question qu'en devinant le contexte
 * (ex. réponse réduite à un chiffre ou un symbole de schéma isolé).
 *
 * …et si elle ne COMMENCE PAS PAR UN CONNECTEUR. « Donc en contact direct
 * avec le sinus maxillaire » : le « donc » renvoie à une phrase que la carte
 * n'affiche pas. Mesuré sur un vrai cours, c'est la signature d'un morceau
 * arraché à son contexte — et la réponse d'une carte doit se tenir seule.
 */
export function isPlausibleAnswerText(rawAnswer: string): boolean {
  const answer = rawAnswer.trim();
  if (answer.length === 0) return false;
  if (SYMBOLS_ONLY.test(answer)) return false;
  if (CONNECTOR_START.test(answer)) return false;

  const words = answer.match(/[a-zà-ÿ]+/gi) ?? [];
  return words.some((word) => word.length >= 3 && !ROMAN_NUMERAL_ONLY.test(word));
}
