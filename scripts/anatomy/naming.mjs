/**
 * Nomenclature FR / latine des structures BodyParts3D exploitées.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * BodyParts3D ne fournit qu'un libellé ANGLAIS par structure
 * (`parts_list_e.txt`) — aucun nom français ni latin. Ce fichier est donc la
 * seule couche du pipeline où une information n'est pas directement lue dans
 * la source. Il est volontairement isolé, exhaustif et relisible ligne à
 * ligne, pour que la traduction reste auditable.
 *
 * RÈGLES SUIVIES
 * --------------
 * - `fr` : traduction du libellé anglais de la source. Traduire n'est pas
 *   inventer — la structure existe bien dans les données.
 * - `la` : nom de la Terminologia Anatomica, renseigné UNIQUEMENT quand il
 *   est certain. Dans le doute → `null`, et l'interface n'affiche alors
 *   simplement pas de nom latin (jamais un latin approximatif).
 * - `g` : genre grammatical du nom français, utilisé pour accorder le côté
 *   (« droit » / « droite »). « gauche » est invariable.
 * - `sys` : système anatomique, `sub` : région — tous deux recoupés avec
 *   l'arbre d'inclusion officiel de BodyParts3D dans `build-catalog.mjs`.
 *
 * Toute structure présente dans les données mais absente de ce dictionnaire
 * fait échouer la génération du catalogue : impossible d'oublier
 * silencieusement une structure ou d'en afficher une sans nom.
 */

/** Qualificatifs composables, retirés du libellé anglais avant recherche du terme de base. */
export const QUALIFIERS = [
  { en: /^deep part of /, fr: (b) => `${b} (faisceau profond)` },
  { en: /^superficial part of /, fr: (b) => `${b} (faisceau superficiel)` },
  { en: /^anterior belly of /, fr: (b) => `${b} (ventre antérieur)` },
  { en: /^posterior belly of /, fr: (b) => `${b} (ventre postérieur)` },
  { en: /^upper head of /, fr: (b) => `${b} (chef supérieur)` },
  { en: /^lower head of /, fr: (b) => `${b} (chef inférieur)` },
  { en: /^orbital part of /, fr: (b) => `${b} (partie orbitaire)` },
  { en: /^palpebral part of /, fr: (b) => `${b} (partie palpébrale)` },
  { en: /^superior oblique part of /, fr: (b) => `${b} (partie oblique supérieure)` },
  { en: /^inferior oblique part of /, fr: (b) => `${b} (partie oblique inférieure)` },
  { en: /^vertical intermediate part of /, fr: (b) => `${b} (partie verticale intermédiaire)` },
  { en: /^anterior part of /, fr: (b) => `${b} (partie antérieure)` },
  { en: /^posterior part of /, fr: (b) => `${b} (partie postérieure)` },
  { en: /^set of /, fr: (b) => `${b} (ensemble)` },
  { en: /^brachium of /, fr: (b) => `Bras du ${b.charAt(0).toLowerCase()}${b.slice(1)}` },
];

/**
 * Terme de base anglais → { fr, g, la, sys, sub }.
 * sys : squelette | muscles | nerfs | vaisseaux | organes
 * sub : crane | face | machoire | dents | cou | orbite | encephale
 */
export const TERMS = {
  // ---------------------------------------------------------------- crâne
  'frontal bone': { fr: 'Os frontal', g: 'm', la: 'Os frontale', sys: 'squelette', sub: 'crane' },
  'parietal bone': { fr: 'Os pariétal', g: 'm', la: 'Os parietale', sys: 'squelette', sub: 'crane' },
  'occipital bone': { fr: 'Os occipital', g: 'm', la: 'Os occipitale', sys: 'squelette', sub: 'crane' },
  'temporal bone': { fr: 'Os temporal', g: 'm', la: 'Os temporale', sys: 'squelette', sub: 'crane' },
  'sphenoid bone': { fr: 'Os sphénoïde', g: 'm', la: 'Os sphenoidale', sys: 'squelette', sub: 'crane' },
  ethmoid: { fr: 'Os ethmoïde', g: 'm', la: 'Os ethmoidale', sys: 'squelette', sub: 'crane' },

  // ----------------------------------------------------------------- face
  'zygomatic bone': { fr: 'Os zygomatique', g: 'm', la: 'Os zygomaticum', sys: 'squelette', sub: 'face' },
  'nasal bone': { fr: 'Os nasal', g: 'm', la: 'Os nasale', sys: 'squelette', sub: 'face' },
  'lacrimal bone': { fr: 'Os lacrymal', g: 'm', la: 'Os lacrimale', sys: 'squelette', sub: 'face' },
  'palatine bone': { fr: 'Os palatin', g: 'm', la: 'Os palatinum', sys: 'squelette', sub: 'face' },
  vomer: { fr: 'Vomer', g: 'm', la: 'Vomer', sys: 'squelette', sub: 'face' },
  'inferior nasal concha': { fr: 'Cornet nasal inférieur', g: 'm', la: 'Concha nasalis inferior', sys: 'squelette', sub: 'face' },
  'nasal cartilages': { fr: 'Cartilages du nez', g: 'm', la: 'Cartilagines nasi', sys: 'organes', sub: 'face' },

  // ------------------------------------------------------------- mâchoire
  mandible: { fr: 'Mandibule', g: 'f', la: 'Mandibula', sys: 'squelette', sub: 'machoire' },
  maxilla: { fr: 'Maxillaire', g: 'm', la: 'Maxilla', sys: 'squelette', sub: 'machoire' },
  'hyoid bone': { fr: 'Os hyoïde', g: 'm', la: 'Os hyoideum', sys: 'squelette', sub: 'machoire' },

  // ----------------------------------------------------------------- dents
  'gingiva of upper jaw': { fr: 'Gencive maxillaire', g: 'f', la: 'Gingiva', sys: 'organes', sub: 'dents' },
  'gingiva of lower jaw': { fr: 'Gencive mandibulaire', g: 'f', la: 'Gingiva', sys: 'organes', sub: 'dents' },
  'labial part of mouth, nsn': { fr: 'Lèvres', g: 'f', la: 'Labia oris', sys: 'organes', sub: 'dents' },

  // ------------------------------------------------- muscles masticateurs
  masseter: { fr: 'Masséter', g: 'm', la: 'Musculus masseter', sys: 'muscles', sub: 'machoire' },
  temporalis: { fr: 'Muscle temporal', g: 'm', la: 'Musculus temporalis', sys: 'muscles', sub: 'machoire' },
  'medial pterygoid': { fr: 'Ptérygoïdien médial', g: 'm', la: 'Musculus pterygoideus medialis', sys: 'muscles', sub: 'machoire' },
  'lateral pterygoid': { fr: 'Ptérygoïdien latéral', g: 'm', la: 'Musculus pterygoideus lateralis', sys: 'muscles', sub: 'machoire' },

  // --------------------------------------------------- muscles de la face
  buccinator: { fr: 'Buccinateur', g: 'm', la: 'Musculus buccinator', sys: 'muscles', sub: 'face' },
  'orbicularis oris': { fr: 'Orbiculaire de la bouche', g: 'm', la: 'Musculus orbicularis oris', sys: 'muscles', sub: 'face' },
  'orbicularis oculi': { fr: 'Orbiculaire de l’œil', g: 'm', la: 'Musculus orbicularis oculi', sys: 'muscles', sub: 'orbite' },
  'corrugator supercilii': { fr: 'Corrugateur du sourcil', g: 'm', la: 'Musculus corrugator supercilii', sys: 'muscles', sub: 'orbite' },
  'zygomaticus major': { fr: 'Grand zygomatique', g: 'm', la: 'Musculus zygomaticus major', sys: 'muscles', sub: 'face' },
  'zygomaticus minor': { fr: 'Petit zygomatique', g: 'm', la: 'Musculus zygomaticus minor', sys: 'muscles', sub: 'face' },
  risorius: { fr: 'Risorius', g: 'm', la: 'Musculus risorius', sys: 'muscles', sub: 'face' },
  mentalis: { fr: 'Mentonnier', g: 'm', la: 'Musculus mentalis', sys: 'muscles', sub: 'face' },
  procerus: { fr: 'Procérus', g: 'm', la: 'Musculus procerus', sys: 'muscles', sub: 'face' },
  nasalis: { fr: 'Muscle nasal', g: 'm', la: 'Musculus nasalis', sys: 'muscles', sub: 'face' },
  'depressor septi nasi': { fr: 'Abaisseur du septum nasal', g: 'm', la: 'Musculus depressor septi nasi', sys: 'muscles', sub: 'face' },
  'levator anguli oris': { fr: 'Élévateur de l’angle de la bouche', g: 'm', la: 'Musculus levator anguli oris', sys: 'muscles', sub: 'face' },
  'levator labii superioris': { fr: 'Élévateur de la lèvre supérieure', g: 'm', la: 'Musculus levator labii superioris', sys: 'muscles', sub: 'face' },
  'levator labii superioris alaeque nasi': { fr: 'Élévateur de la lèvre supérieure et de l’aile du nez', g: 'm', la: 'Musculus levator labii superioris alaeque nasi', sys: 'muscles', sub: 'face' },
  'depressor anguli oris': { fr: 'Abaisseur de l’angle de la bouche', g: 'm', la: 'Musculus depressor anguli oris', sys: 'muscles', sub: 'face' },
  'depressor labii inferioris': { fr: 'Abaisseur de la lèvre inférieure', g: 'm', la: 'Musculus depressor labii inferioris', sys: 'muscles', sub: 'face' },
  frontalis: { fr: 'Frontal (muscle)', g: 'm', la: 'Venter frontalis musculi occipitofrontalis', sys: 'muscles', sub: 'face' },
  occipitalis: { fr: 'Occipital (muscle)', g: 'm', la: 'Venter occipitalis musculi occipitofrontalis', sys: 'muscles', sub: 'crane' },
  temporoparietalis: { fr: 'Temporo-pariétal', g: 'm', la: 'Musculus temporoparietalis', sys: 'muscles', sub: 'crane' },
  'aponeurosis of epicranius': { fr: 'Aponévrose épicrânienne', g: 'f', la: 'Galea aponeurotica', sys: 'muscles', sub: 'crane' },

  // ------------------------------------------- muscles hyoïdiens et du cou
  digastric: { fr: 'Digastrique', g: 'm', la: 'Musculus digastricus', sys: 'muscles', sub: 'cou' },
  mylohyoid: { fr: 'Mylo-hyoïdien', g: 'm', la: 'Musculus mylohyoideus', sys: 'muscles', sub: 'cou' },
  geniohyoid: { fr: 'Génio-hyoïdien', g: 'm', la: 'Musculus geniohyoideus', sys: 'muscles', sub: 'cou' },
  stylohyoid: { fr: 'Stylo-hyoïdien', g: 'm', la: 'Musculus stylohyoideus', sys: 'muscles', sub: 'cou' },
  sternohyoid: { fr: 'Sterno-hyoïdien', g: 'm', la: 'Musculus sternohyoideus', sys: 'muscles', sub: 'cou' },
  sternothyroid: { fr: 'Sterno-thyroïdien', g: 'm', la: 'Musculus sternothyroideus', sys: 'muscles', sub: 'cou' },
  thyrohyoid: { fr: 'Thyro-hyoïdien', g: 'm', la: 'Musculus thyrohyoideus', sys: 'muscles', sub: 'cou' },
  omohyoid: { fr: 'Omo-hyoïdien', g: 'm', la: 'Musculus omohyoideus', sys: 'muscles', sub: 'cou' },
  sternocleidomastoid: { fr: 'Sterno-cléido-mastoïdien', g: 'm', la: 'Musculus sternocleidomastoideus', sys: 'muscles', sub: 'cou' },
  platysma: { fr: 'Platysma', g: 'm', la: 'Platysma', sys: 'muscles', sub: 'cou' },
  'scalenus anterior': { fr: 'Scalène antérieur', g: 'm', la: 'Musculus scalenus anterior', sys: 'muscles', sub: 'cou' },
  'scalenus medius': { fr: 'Scalène moyen', g: 'm', la: 'Musculus scalenus medius', sys: 'muscles', sub: 'cou' },
  'scalenus posterior': { fr: 'Scalène postérieur', g: 'm', la: 'Musculus scalenus posterior', sys: 'muscles', sub: 'cou' },
  'longus capitis': { fr: 'Long de la tête', g: 'm', la: 'Musculus longus capitis', sys: 'muscles', sub: 'cou' },
  'longus colli': { fr: 'Long du cou', g: 'm', la: 'Musculus longus colli', sys: 'muscles', sub: 'cou' },
  'rectus capitis anterior': { fr: 'Droit antérieur de la tête', g: 'm', la: 'Musculus rectus capitis anterior', sys: 'muscles', sub: 'cou' },
  'rectus capitis lateralis': { fr: 'Droit latéral de la tête', g: 'm', la: 'Musculus rectus capitis lateralis', sys: 'muscles', sub: 'cou' },
  'rectus capitis posterior major': { fr: 'Grand droit postérieur de la tête', g: 'm', la: 'Musculus rectus capitis posterior major', sys: 'muscles', sub: 'cou' },
  'rectus capitis posterior minor': { fr: 'Petit droit postérieur de la tête', g: 'm', la: 'Musculus rectus capitis posterior minor', sys: 'muscles', sub: 'cou' },
  'obliquus capitis superior': { fr: 'Oblique supérieur de la tête', g: 'm', la: 'Musculus obliquus capitis superior', sys: 'muscles', sub: 'cou' },
  'obliquus capitis inferior': { fr: 'Oblique inférieur de la tête', g: 'm', la: 'Musculus obliquus capitis inferior', sys: 'muscles', sub: 'cou' },
  'cervical rotator': { fr: 'Rotateur cervical', g: 'm', la: 'Musculi rotatores cervicis', sys: 'muscles', sub: 'cou' },
  'anterior cervical intertransversarii': { fr: 'Intertransversaires cervicaux antérieurs', g: 'm', la: 'Musculi intertransversarii anteriores cervicis', sys: 'muscles', sub: 'cou' },
  'posterior cervical intertransversarii': { fr: 'Intertransversaires cervicaux postérieurs', g: 'm', la: 'Musculi intertransversarii posteriores cervicis', sys: 'muscles', sub: 'cou' },
  'levator scapulae': { fr: 'Élévateur de la scapula', g: 'm', la: 'Musculus levator scapulae', sys: 'muscles', sub: 'cou' },

  // ------------------------------------------------------ rachis cervical
  atlas: { fr: 'Atlas (C1)', g: 'm', la: 'Atlas', sys: 'squelette', sub: 'cou' },
  axis: { fr: 'Axis (C2)', g: 'm', la: 'Axis', sys: 'squelette', sub: 'cou' },
  'third cervical vertebra': { fr: 'Vertèbre cervicale C3', g: 'f', la: 'Vertebra cervicalis III', sys: 'squelette', sub: 'cou' },
  'fourth cervical vertebra': { fr: 'Vertèbre cervicale C4', g: 'f', la: 'Vertebra cervicalis IV', sys: 'squelette', sub: 'cou' },
  'fifth cervical vertebra': { fr: 'Vertèbre cervicale C5', g: 'f', la: 'Vertebra cervicalis V', sys: 'squelette', sub: 'cou' },
  'sixth cervical vertebra': { fr: 'Vertèbre cervicale C6', g: 'f', la: 'Vertebra cervicalis VI', sys: 'squelette', sub: 'cou' },
  'seventh cervical vertebra': { fr: 'Vertèbre cervicale C7', g: 'f', la: 'Vertebra cervicalis VII', sys: 'squelette', sub: 'cou' },
  'intervertebral disk of axis': { fr: 'Disque intervertébral C2-C3', g: 'm', la: 'Discus intervertebralis', sys: 'squelette', sub: 'cou' },
  'intervertebral disk of third cervical vertebra': { fr: 'Disque intervertébral C3-C4', g: 'm', la: 'Discus intervertebralis', sys: 'squelette', sub: 'cou' },
  'intervertebral disk of fourth cervical vertebra': { fr: 'Disque intervertébral C4-C5', g: 'm', la: 'Discus intervertebralis', sys: 'squelette', sub: 'cou' },
  'intervertebral disk of fifth cervical vertebra': { fr: 'Disque intervertébral C5-C6', g: 'm', la: 'Discus intervertebralis', sys: 'squelette', sub: 'cou' },
  'intervertebral disk of sixth cervical vertebra': { fr: 'Disque intervertébral C6-C7', g: 'm', la: 'Discus intervertebralis', sys: 'squelette', sub: 'cou' },
  'intervertebral disk of seventh cervical vertebra': { fr: 'Disque intervertébral C7-T1', g: 'm', la: 'Discus intervertebralis', sys: 'squelette', sub: 'cou' },
  clavicle: { fr: 'Clavicule', g: 'f', la: 'Clavicula', sys: 'squelette', sub: 'cou' },
  manubrium: { fr: 'Manubrium sternal', g: 'm', la: 'Manubrium sterni', sys: 'squelette', sub: 'cou' },

  // ------------------------------------------------ viscères et cartilages
  'thyroid cartilage': { fr: 'Cartilage thyroïde', g: 'm', la: 'Cartilago thyroidea', sys: 'organes', sub: 'cou' },
  trachea: { fr: 'Trachée', g: 'f', la: 'Trachea', sys: 'organes', sub: 'cou' },
  esophagus: { fr: 'Œsophage', g: 'm', la: 'Oesophagus', sys: 'organes', sub: 'cou' },
  'pituitary gland': { fr: 'Hypophyse', g: 'f', la: 'Hypophysis', sys: 'organes', sub: 'crane' },
  ear: { fr: 'Oreille', g: 'f', la: 'Auris', sys: 'organes', sub: 'crane' },
  eyeball: { fr: 'Globe oculaire', g: 'm', la: 'Bulbus oculi', sys: 'organes', sub: 'orbite' },
  eyebrows: { fr: 'Sourcils', g: 'm', la: 'Supercilia', sys: 'organes', sub: 'orbite' },

  // -------------------------------------------------------------- nerfs
  'optic nerve': { fr: 'Nerf optique (II)', g: 'm', la: 'Nervus opticus', sys: 'nerfs', sub: 'orbite' },
  'optic tract': { fr: 'Tractus optique', g: 'm', la: 'Tractus opticus', sys: 'nerfs', sub: 'orbite' },
  'optic chiasm': { fr: 'Chiasma optique', g: 'm', la: 'Chiasma opticum', sys: 'nerfs', sub: 'orbite' },

  // ----------------------------------------------------------- vaisseaux
  'common carotid artery': { fr: 'Artère carotide commune', g: 'f', la: 'Arteria carotis communis', sys: 'vaisseaux', sub: 'cou' },
  'internal jugular vein': { fr: 'Veine jugulaire interne', g: 'f', la: 'Vena jugularis interna', sys: 'vaisseaux', sub: 'cou' },

  // ------------------------------------------------------------ encéphale
  // Le jeu de données contient un encéphale segmenté (74 structures). Il est
  // secondaire pour la dentisterie mais bien présent : il est donc exploité,
  // dans sa propre région chargée à la demande (voir `subregion: encephale`
  // attribué par build-catalog.mjs d'après l'arbre officiel).
  cerebellum: { fr: 'Cervelet', g: 'm', la: 'Cerebellum', sys: 'nerfs', sub: 'encephale' },
  pons: { fr: 'Pont', g: 'm', la: 'Pons', sys: 'nerfs', sub: 'encephale' },
  'medulla oblongata': { fr: 'Bulbe rachidien', g: 'm', la: 'Medulla oblongata', sys: 'nerfs', sub: 'encephale' },
  'midbrain, nsn': { fr: 'Mésencéphale', g: 'm', la: 'Mesencephalon', sys: 'nerfs', sub: 'encephale' },
  'peduncle of midbrain': { fr: 'Pédoncule cérébral', g: 'm', la: 'Pedunculus cerebri', sys: 'nerfs', sub: 'encephale' },
  'cerebral aqueduct': { fr: 'Aqueduc du mésencéphale', g: 'm', la: 'Aqueductus mesencephali', sys: 'nerfs', sub: 'encephale' },
  'third ventricle': { fr: 'Troisième ventricule', g: 'm', la: 'Ventriculus tertius', sys: 'nerfs', sub: 'encephale' },
  'fourth ventricle': { fr: 'Quatrième ventricule', g: 'm', la: 'Ventriculus quartus', sys: 'nerfs', sub: 'encephale' },
  'lateral ventricle': { fr: 'Ventricule latéral', g: 'm', la: 'Ventriculus lateralis', sys: 'nerfs', sub: 'encephale' },
  'septum pellucidum': { fr: 'Septum pellucidum', g: 'm', la: 'Septum pellucidum', sys: 'nerfs', sub: 'encephale' },
  thalamus: { fr: 'Thalamus', g: 'm', la: 'Thalamus', sys: 'nerfs', sub: 'encephale' },
  'hypothalamus, nsn': { fr: 'Hypothalamus', g: 'm', la: 'Hypothalamus', sys: 'nerfs', sub: 'encephale' },
  'tuber cinereum': { fr: 'Tuber cinereum', g: 'm', la: 'Tuber cinereum', sys: 'nerfs', sub: 'encephale' },
  habenula: { fr: 'Habénula', g: 'f', la: 'Habenula', sys: 'nerfs', sub: 'encephale' },
  'pineal body': { fr: 'Épiphyse', g: 'f', la: 'Corpus pineale', sys: 'nerfs', sub: 'encephale' },
  'caudate nucleus': { fr: 'Noyau caudé', g: 'm', la: 'Nucleus caudatus', sys: 'nerfs', sub: 'encephale' },
  putamen: { fr: 'Putamen', g: 'm', la: 'Putamen', sys: 'nerfs', sub: 'encephale' },
  'globus pallidus': { fr: 'Globus pallidus', g: 'm', la: 'Globus pallidus', sys: 'nerfs', sub: 'encephale' },
  amygdala: { fr: 'Amygdale', g: 'f', la: 'Corpus amygdaloideum', sys: 'nerfs', sub: 'encephale' },
  hippocampus: { fr: 'Hippocampe', g: 'm', la: 'Hippocampus', sys: 'nerfs', sub: 'encephale' },
  insula: { fr: 'Insula', g: 'f', la: 'Insula', sys: 'nerfs', sub: 'encephale' },
  'superior colliculus': { fr: 'Colliculus supérieur', g: 'm', la: 'Colliculus superior', sys: 'nerfs', sub: 'encephale' },
  'inferior colliculus': { fr: 'Colliculus inférieur', g: 'm', la: 'Colliculus inferior', sys: 'nerfs', sub: 'encephale' },
  'lateral geniculate body': { fr: 'Corps géniculé latéral', g: 'm', la: 'Corpus geniculatum laterale', sys: 'nerfs', sub: 'encephale' },
  'medial geniculate body': { fr: 'Corps géniculé médial', g: 'm', la: 'Corpus geniculatum mediale', sys: 'nerfs', sub: 'encephale' },
  'superior frontal gyrus': { fr: 'Gyrus frontal supérieur', g: 'm', la: 'Gyrus frontalis superior', sys: 'nerfs', sub: 'encephale' },
  'middle frontal gyrus': { fr: 'Gyrus frontal moyen', g: 'm', la: 'Gyrus frontalis medius', sys: 'nerfs', sub: 'encephale' },
  'precentral gyrus': { fr: 'Gyrus précentral', g: 'm', la: 'Gyrus precentralis', sys: 'nerfs', sub: 'encephale' },
  'postcentral gyrus': { fr: 'Gyrus postcentral', g: 'm', la: 'Gyrus postcentralis', sys: 'nerfs', sub: 'encephale' },
  'superior temporal gyrus': { fr: 'Gyrus temporal supérieur', g: 'm', la: 'Gyrus temporalis superior', sys: 'nerfs', sub: 'encephale' },
  'middle temporal gyrus': { fr: 'Gyrus temporal moyen', g: 'm', la: 'Gyrus temporalis medius', sys: 'nerfs', sub: 'encephale' },
  'inferior temporal gyrus': { fr: 'Gyrus temporal inférieur', g: 'm', la: 'Gyrus temporalis inferior', sys: 'nerfs', sub: 'encephale' },
  'cingulate gyrus': { fr: 'Gyrus cingulaire', g: 'm', la: 'Gyrus cinguli', sys: 'nerfs', sub: 'encephale' },
  'parahippocampal gyrus': { fr: 'Gyrus parahippocampique', g: 'm', la: 'Gyrus parahippocampalis', sys: 'nerfs', sub: 'encephale' },
  'fusiform gyrus': { fr: 'Gyrus fusiforme', g: 'm', la: 'Gyrus fusiformis', sys: 'nerfs', sub: 'encephale' },
  'supramarginal gyrus': { fr: 'Gyrus supramarginal', g: 'm', la: 'Gyrus supramarginalis', sys: 'nerfs', sub: 'encephale' },
  'angular gyrus': { fr: 'Gyrus angulaire', g: 'm', la: 'Gyrus angularis', sys: 'nerfs', sub: 'encephale' },
  'accessory short gyrus': { fr: 'Gyrus court accessoire de l’insula', g: 'm', la: null, sys: 'nerfs', sub: 'encephale' },
  'occipital lobe': { fr: 'Lobe occipital', g: 'm', la: 'Lobus occipitalis', sys: 'nerfs', sub: 'encephale' },
  // Libellés composites propres à BodyParts3D (identifiants « BP… », sans
  // équivalent FMA) : nommés tels quels, sans latin inventé.
  'superior parietal lobule precuneus': { fr: 'Lobule pariétal supérieur — précunéus', g: 'm', la: null, sys: 'nerfs', sub: 'encephale' },
  'orbital gyri straight gyrus': { fr: 'Gyrus orbitaires et gyrus droit', g: 'm', la: null, sys: 'nerfs', sub: 'encephale' },
};

/**
 * Dents : numérotation FDI reconstruite depuis le libellé anglais
 * (« right upper first secondary molar tooth » → 16). Les dents de sagesse
 * (18/28/38/48) sont ABSENTES du jeu de données — elles ne sont donc pas
 * générées ici, et n'apparaîtront pas comme présentes dans l'atlas.
 */
export const TOOTH_KINDS = {
  'central secondary incisor': { fr: 'Incisive centrale', pos: 1 },
  'lateral secondary incisor': { fr: 'Incisive latérale', pos: 2 },
  'secondary canine': { fr: 'Canine', pos: 3 },
  'first secondary premolar': { fr: 'Première prémolaire', pos: 4 },
  'second secondary premolar': { fr: 'Deuxième prémolaire', pos: 5 },
  'first secondary molar': { fr: 'Première molaire', pos: 6 },
  'second secondary molar': { fr: 'Deuxième molaire', pos: 7 },
};

/** Quadrants FDI : dizaine selon (haut/bas, droite/gauche) du point de vue du patient. */
export const FDI_QUADRANT = {
  'upper-right': 1,
  'upper-left': 2,
  'lower-left': 3,
  'lower-right': 4,
};

export const TOOTH_LATIN = {
  'Incisive centrale': 'Dens incisivus centralis',
  'Incisive latérale': 'Dens incisivus lateralis',
  Canine: 'Dens caninus',
  'Première prémolaire': 'Dens premolaris primus',
  'Deuxième prémolaire': 'Dens premolaris secundus',
  'Première molaire': 'Dens molaris primus',
  'Deuxième molaire': 'Dens molaris secundus',
};

/** Accorde le côté avec le genre du nom français. */
export function withSide(fr, gender, side) {
  if (!side) return fr;
  if (side === 'left') return `${fr} gauche`;
  return `${fr} ${gender === 'f' ? 'droite' : 'droit'}`;
}
