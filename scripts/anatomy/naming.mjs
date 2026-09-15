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

/* ==========================================================================
 * RÈGLES DÉRIVÉES — motifs réguliers de la source
 * ==========================================================================
 * Côtes, vertèbres, disques, métacarpiens, métatarsiens, phalanges, lombricaux
 * et interosseux suivent une numérotation régulière dans BodyParts3D. Les
 * décrire par une règle plutôt que par des centaines d'entrées quasi
 * identiques garde le fichier lisible ET vérifiable : chaque règle est une
 * fonction pure, testée dans `tests/core/anatomy-naming.test.ts`.
 */

const ORDINAL = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
};
const ORDINAL_FR = {
  1: 'première', 2: 'deuxième', 3: 'troisième', 4: 'quatrième', 5: 'cinquième', 6: 'sixième',
  7: 'septième', 8: 'huitième', 9: 'neuvième', 10: 'dixième', 11: 'onzième', 12: 'douzième',
};
const DIGIT_FR = {
  thumb: 'du pouce', 'index finger': 'de l’index', 'middle finger': 'du majeur',
  'ring finger': 'de l’annulaire', 'little finger': 'de l’auriculaire',
  'big toe': 'de l’hallux', 'great toe': 'de l’hallux', 'second toe': 'du 2ᵉ orteil', 'third toe': 'du 3ᵉ orteil',
  'fourth toe': 'du 4ᵉ orteil', 'little toe': 'du 5ᵉ orteil',
};

/**
 * Chaque règle reçoit la racine anglaise et rend une entrée de nomenclature
 * ({ fr, g, la, sys }) ou `null` si le motif ne s'applique pas.
 */
export const DERIVED_RULES = [
  // Côtes : « third rib »
  (b) => {
    const m = /^(\w+) rib$/.exec(b);
    const n = m && ORDINAL[m[1]];
    return n ? { fr: `${ORDINAL_FR[n]} côte`, g: 'f', la: `Costa ${n}`, sys: 'squelette' } : null;
  },
  // Cartilages costaux : « third costal cartilage »
  (b) => {
    const m = /^(\w+) costal cartilage$/.exec(b);
    const n = m && ORDINAL[m[1]];
    return n ? { fr: `Cartilage costal ${n}`, g: 'm', la: 'Cartilago costalis', sys: 'squelette' } : null;
  },
  (b) => (b === 'costal cartilage' ? { fr: 'Cartilage costal', g: 'm', la: 'Cartilago costalis', sys: 'squelette' } : null),
  // Vertèbres thoraciques / lombaires
  (b) => {
    const m = /^(\w+) (thoracic|lumbar) vertebra$/.exec(b);
    const n = m && ORDINAL[m[1]];
    if (!n) return null;
    const p = m[2] === 'thoracic' ? 'T' : 'L';
    return { fr: `Vertèbre ${m[2] === 'thoracic' ? 'thoracique' : 'lombaire'} ${p}${n}`, g: 'f', la: null, sys: 'squelette' };
  },
  // Disques intervertébraux
  (b) => {
    const m = /^intervertebral disk of (\w+) (thoracic|lumbar) vertebra$/.exec(b);
    const n = m && ORDINAL[m[1]];
    if (!n) return null;
    const p = m[2] === 'thoracic' ? 'T' : 'L';
    return { fr: `Disque intervertébral ${p}${n}`, g: 'm', la: 'Discus intervertebralis', sys: 'squelette' };
  },
  // Métacarpiens / métatarsiens
  (b) => {
    const m = /^(\w+) (metacarpal|metatarsal) bone$/.exec(b);
    const n = m && ORDINAL[m[1]];
    if (!n) return null;
    const isHand = m[2] === 'metacarpal';
    return {
      fr: `${isHand ? 'Métacarpien' : 'Métatarsien'} ${n}`,
      g: 'm',
      la: `Os ${isHand ? 'metacarpi' : 'metatarsi'} ${n}`,
      sys: 'squelette',
    };
  },
  // Phalanges : « distal phalanx of index finger »
  (b) => {
    const m = /^(distal|middle|proximal) phalanx of (.+)$/.exec(b);
    if (!m) return null;
    const rank = { distal: 'distale', middle: 'moyenne', proximal: 'proximale' }[m[1]];
    const digit = DIGIT_FR[m[2]];
    if (!digit) return null;
    return { fr: `Phalange ${rank} ${digit}`, g: 'f', la: null, sys: 'squelette' };
  },
  // Lombricaux et interosseux numérotés
  (b) => {
    const m = /^(\w+) lumbrical of (foot|hand)$/.exec(b);
    const n = m && ORDINAL[m[1]];
    return n
      ? { fr: `${ORDINAL_FR[n]} lombrical ${m[2] === 'foot' ? 'du pied' : 'de la main'}`, g: 'm', la: 'Musculus lumbricalis', sys: 'muscles' }
      : null;
  },
  (b) => {
    const m = /^(\w+) plantar interosseous of foot$/.exec(b);
    const n = m && ORDINAL[m[1]];
    return n
      ? { fr: `${ORDINAL_FR[n]} interosseux plantaire`, g: 'm', la: 'Musculus interosseus plantaris', sys: 'muscles' }
      : null;
  },
];

/* ==========================================================================
 * CORPS ENTIER — os, muscles, vaisseaux, organes hors tête et cou
 * ==========================================================================
 * Même règle que ci-dessus : `fr` traduit le libellé source, `la` n'est
 * renseigné que lorsqu'il est certain (pour de nombreux muscles, le libellé
 * anglais de BodyParts3D EST déjà le terme latin), `g` sert à accorder le
 * côté. La région n'est PAS indiquée ici : elle est dérivée de l'arbre
 * d'inclusion par `build-catalog.mjs`.
 */
Object.assign(TERMS, {
  // ------------------------------------------------------------ squelette
  humerus: { fr: 'Humérus', g: 'm', la: 'Humerus', sys: 'squelette' },
  radius: { fr: 'Radius', g: 'm', la: 'Radius', sys: 'squelette' },
  ulna: { fr: 'Ulna', g: 'm', la: 'Ulna', sys: 'squelette' },
  scapula: { fr: 'Scapula', g: 'f', la: 'Scapula', sys: 'squelette' },
  femur: { fr: 'Fémur', g: 'm', la: 'Femur', sys: 'squelette' },
  patella: { fr: 'Patella', g: 'f', la: 'Patella', sys: 'squelette' },
  tibia: { fr: 'Tibia', g: 'm', la: 'Tibia', sys: 'squelette' },
  fibula: { fr: 'Fibula', g: 'f', la: 'Fibula', sys: 'squelette' },
  'hip bone': { fr: 'Os coxal', g: 'm', la: 'Os coxae', sys: 'squelette' },
  sacrum: { fr: 'Sacrum', g: 'm', la: 'Os sacrum', sys: 'squelette' },
  'body of sternum': { fr: 'Corps du sternum', g: 'm', la: 'Corpus sterni', sys: 'squelette' },
  'xiphoid process': { fr: 'Processus xiphoïde', g: 'm', la: 'Processus xiphoideus', sys: 'squelette' },
  // — carpe
  scaphoid: { fr: 'Scaphoïde', g: 'm', la: 'Os scaphoideum', sys: 'squelette' },
  lunate: { fr: 'Lunatum', g: 'm', la: 'Os lunatum', sys: 'squelette' },
  triquetral: { fr: 'Triquétrum', g: 'm', la: 'Os triquetrum', sys: 'squelette' },
  pisiform: { fr: 'Pisiforme', g: 'm', la: 'Os pisiforme', sys: 'squelette' },
  trapezium: { fr: 'Trapèze', g: 'm', la: 'Os trapezium', sys: 'squelette' },
  trapezoid: { fr: 'Trapézoïde', g: 'm', la: 'Os trapezoideum', sys: 'squelette' },
  capitate: { fr: 'Capitatum', g: 'm', la: 'Os capitatum', sys: 'squelette' },
  hamate: { fr: 'Hamatum', g: 'm', la: 'Os hamatum', sys: 'squelette' },
  // — tarse
  talus: { fr: 'Talus', g: 'm', la: 'Talus', sys: 'squelette' },
  calcaneus: { fr: 'Calcanéus', g: 'm', la: 'Calcaneus', sys: 'squelette' },
  'navicular bone of foot': { fr: 'Naviculaire', g: 'm', la: 'Os naviculare', sys: 'squelette' },
  'cuboid bone': { fr: 'Cuboïde', g: 'm', la: 'Os cuboideum', sys: 'squelette' },
  'medial cuneiform bone': { fr: 'Cunéiforme médial', g: 'm', la: 'Os cuneiforme mediale', sys: 'squelette' },
  'intermediate cuneiform bone': { fr: 'Cunéiforme intermédiaire', g: 'm', la: 'Os cuneiforme intermedium', sys: 'squelette' },
  'lateral cuneiform bone': { fr: 'Cunéiforme latéral', g: 'm', la: 'Os cuneiforme laterale', sys: 'squelette' },
  'sesamoid bone of foot': { fr: 'Os sésamoïde du pied', g: 'm', la: 'Os sesamoideum', sys: 'squelette' },

  // ---------------------------------------------------- muscles — épaule/bras
  deltoid: { fr: 'Deltoïde', g: 'm', la: 'Musculus deltoideus', sys: 'muscles' },
  supraspinatus: { fr: 'Supra-épineux', g: 'm', la: 'Musculus supraspinatus', sys: 'muscles' },
  'infraspinatus muscle': { fr: 'Infra-épineux', g: 'm', la: 'Musculus infraspinatus', sys: 'muscles' },
  'teres major': { fr: 'Grand rond', g: 'm', la: 'Musculus teres major', sys: 'muscles' },
  'teres minor': { fr: 'Petit rond', g: 'm', la: 'Musculus teres minor', sys: 'muscles' },
  subscapularis: { fr: 'Subscapulaire', g: 'm', la: 'Musculus subscapularis', sys: 'muscles' },
  'biceps brachii': { fr: 'Biceps brachial', g: 'm', la: 'Musculus biceps brachii', sys: 'muscles' },
  'triceps brachii': { fr: 'Triceps brachial', g: 'm', la: 'Musculus triceps brachii', sys: 'muscles' },
  brachialis: { fr: 'Brachial', g: 'm', la: 'Musculus brachialis', sys: 'muscles' },
  coracobrachialis: { fr: 'Coraco-brachial', g: 'm', la: 'Musculus coracobrachialis', sys: 'muscles' },
  anconeus: { fr: 'Anconé', g: 'm', la: 'Musculus anconeus', sys: 'muscles' },
  brachioradialis: { fr: 'Brachio-radial', g: 'm', la: 'Musculus brachioradialis', sys: 'muscles' },
  subclavius: { fr: 'Subclavier', g: 'm', la: 'Musculus subclavius', sys: 'muscles' },
  'pectoralis major': { fr: 'Grand pectoral', g: 'm', la: 'Musculus pectoralis major', sys: 'muscles' },
  'pectoralis minor': { fr: 'Petit pectoral', g: 'm', la: 'Musculus pectoralis minor', sys: 'muscles' },
  'serratus anterior': { fr: 'Dentelé antérieur', g: 'm', la: 'Musculus serratus anterior', sys: 'muscles' },
  'latissimus dorsi': { fr: 'Grand dorsal', g: 'm', la: 'Musculus latissimus dorsi', sys: 'muscles' },
  'rhomboid major': { fr: 'Grand rhomboïde', g: 'm', la: 'Musculus rhomboideus major', sys: 'muscles' },
  'rhomboid minor': { fr: 'Petit rhomboïde', g: 'm', la: 'Musculus rhomboideus minor', sys: 'muscles' },
  trapezius: { fr: 'Trapèze (muscle)', g: 'm', la: 'Musculus trapezius', sys: 'muscles' },

  // ------------------------------------------------ muscles — avant-bras/main
  'pronator teres': { fr: 'Rond pronateur', g: 'm', la: 'Musculus pronator teres', sys: 'muscles' },
  'pronator quadratus': { fr: 'Carré pronateur', g: 'm', la: 'Musculus pronator quadratus', sys: 'muscles' },
  supinator: { fr: 'Supinateur', g: 'm', la: 'Musculus supinator', sys: 'muscles' },
  'flexor carpi radialis': { fr: 'Fléchisseur radial du carpe', g: 'm', la: 'Musculus flexor carpi radialis', sys: 'muscles' },
  'flexor carpi ulnaris': { fr: 'Fléchisseur ulnaire du carpe', g: 'm', la: 'Musculus flexor carpi ulnaris', sys: 'muscles' },
  'palmaris longus': { fr: 'Long palmaire', g: 'm', la: 'Musculus palmaris longus', sys: 'muscles' },
  'flexor digitorum superficialis': { fr: 'Fléchisseur superficiel des doigts', g: 'm', la: 'Musculus flexor digitorum superficialis', sys: 'muscles' },
  'flexor digitorum profundus': { fr: 'Fléchisseur profond des doigts', g: 'm', la: 'Musculus flexor digitorum profundus', sys: 'muscles' },
  'flexor pollicis longus': { fr: 'Long fléchisseur du pouce', g: 'm', la: 'Musculus flexor pollicis longus', sys: 'muscles' },
  'flexor pollicis brevis': { fr: 'Court fléchisseur du pouce', g: 'm', la: 'Musculus flexor pollicis brevis', sys: 'muscles' },
  'extensor carpi radialis longus': { fr: 'Long extenseur radial du carpe', g: 'm', la: 'Musculus extensor carpi radialis longus', sys: 'muscles' },
  'extensor carpi radialis brevis': { fr: 'Court extenseur radial du carpe', g: 'm', la: 'Musculus extensor carpi radialis brevis', sys: 'muscles' },
  'extensor carpi ulnaris': { fr: 'Extenseur ulnaire du carpe', g: 'm', la: 'Musculus extensor carpi ulnaris', sys: 'muscles' },
  'extensor digitorum': { fr: 'Extenseur des doigts', g: 'm', la: 'Musculus extensor digitorum', sys: 'muscles' },
  'extensor digiti minimi': { fr: 'Extenseur du petit doigt', g: 'm', la: 'Musculus extensor digiti minimi', sys: 'muscles' },
  'extensor indicis': { fr: 'Extenseur de l’index', g: 'm', la: 'Musculus extensor indicis', sys: 'muscles' },
  'extensor pollicis longus': { fr: 'Long extenseur du pouce', g: 'm', la: 'Musculus extensor pollicis longus', sys: 'muscles' },
  'extensor pollicis brevis': { fr: 'Court extenseur du pouce', g: 'm', la: 'Musculus extensor pollicis brevis', sys: 'muscles' },
  'abductor pollicis longus': { fr: 'Long abducteur du pouce', g: 'm', la: 'Musculus abductor pollicis longus', sys: 'muscles' },
  'abductor pollicis brevis': { fr: 'Court abducteur du pouce', g: 'm', la: 'Musculus abductor pollicis brevis', sys: 'muscles' },
  'adductor pollicis': { fr: 'Adducteur du pouce', g: 'm', la: 'Musculus adductor pollicis', sys: 'muscles' },
  'opponens pollicis': { fr: 'Opposant du pouce', g: 'm', la: 'Musculus opponens pollicis', sys: 'muscles' },
  'abductor digiti minimi of hand': { fr: 'Abducteur du petit doigt', g: 'm', la: 'Musculus abductor digiti minimi manus', sys: 'muscles' },
  'flexor digiti minimi brevis of hand': { fr: 'Court fléchisseur du petit doigt', g: 'm', la: 'Musculus flexor digiti minimi brevis', sys: 'muscles' },
  'opponens digiti minimi of hand': { fr: 'Opposant du petit doigt', g: 'm', la: 'Musculus opponens digiti minimi', sys: 'muscles' },
  'lumbricals of hand': { fr: 'Lombricaux de la main', g: 'm', la: 'Musculi lumbricales manus', sys: 'muscles' },
  'dorsal interossei of hand': { fr: 'Interosseux dorsaux de la main', g: 'm', la: 'Musculi interossei dorsales manus', sys: 'muscles' },
  'palmar interossei of hand': { fr: 'Interosseux palmaires', g: 'm', la: 'Musculi interossei palmares', sys: 'muscles' },
  'flexor retinaculum of wrist': { fr: 'Rétinaculum des fléchisseurs', g: 'm', la: 'Retinaculum musculorum flexorum', sys: 'muscles' },
  'interosseous membrane of forearm': { fr: 'Membrane interosseuse de l’avant-bras', g: 'f', la: 'Membrana interossea antebrachii', sys: 'squelette' },
  'intermediate tendon': { fr: 'Tendon intermédiaire', g: 'm', la: null, sys: 'muscles' },

  // ------------------------------------------------- muscles — hanche/cuisse
  'gluteus maximus': { fr: 'Grand fessier', g: 'm', la: 'Musculus gluteus maximus', sys: 'muscles' },
  'gluteus medius': { fr: 'Moyen fessier', g: 'm', la: 'Musculus gluteus medius', sys: 'muscles' },
  'gluteus minimus': { fr: 'Petit fessier', g: 'm', la: 'Musculus gluteus minimus', sys: 'muscles' },
  piriformis: { fr: 'Piriforme', g: 'm', la: 'Musculus piriformis', sys: 'muscles' },
  'obturator internus': { fr: 'Obturateur interne', g: 'm', la: 'Musculus obturatorius internus', sys: 'muscles' },
  'obturator externus': { fr: 'Obturateur externe', g: 'm', la: 'Musculus obturatorius externus', sys: 'muscles' },
  'gemellus superior': { fr: 'Jumeau supérieur', g: 'm', la: 'Musculus gemellus superior', sys: 'muscles' },
  'gemellus inferior': { fr: 'Jumeau inférieur', g: 'm', la: 'Musculus gemellus inferior', sys: 'muscles' },
  'quadratus femoris': { fr: 'Carré fémoral', g: 'm', la: 'Musculus quadratus femoris', sys: 'muscles' },
  iliacus: { fr: 'Iliaque', g: 'm', la: 'Musculus iliacus', sys: 'muscles' },
  'psoas major': { fr: 'Grand psoas', g: 'm', la: 'Musculus psoas major', sys: 'muscles' },
  sartorius: { fr: 'Sartorius', g: 'm', la: 'Musculus sartorius', sys: 'muscles' },
  gracilis: { fr: 'Gracile', g: 'm', la: 'Musculus gracilis', sys: 'muscles' },
  pectineus: { fr: 'Pectiné', g: 'm', la: 'Musculus pectineus', sys: 'muscles' },
  'adductor longus': { fr: 'Long adducteur', g: 'm', la: 'Musculus adductor longus', sys: 'muscles' },
  'adductor brevis': { fr: 'Court adducteur', g: 'm', la: 'Musculus adductor brevis', sys: 'muscles' },
  'adductor magnus': { fr: 'Grand adducteur', g: 'm', la: 'Musculus adductor magnus', sys: 'muscles' },
  'adductor minimus': { fr: 'Petit adducteur', g: 'm', la: 'Musculus adductor minimus', sys: 'muscles' },
  'rectus femoris': { fr: 'Droit fémoral', g: 'm', la: 'Musculus rectus femoris', sys: 'muscles' },
  'vastus lateralis': { fr: 'Vaste latéral', g: 'm', la: 'Musculus vastus lateralis', sys: 'muscles' },
  'vastus medialis': { fr: 'Vaste médial', g: 'm', la: 'Musculus vastus medialis', sys: 'muscles' },
  'vastus intermedius': { fr: 'Vaste intermédiaire', g: 'm', la: 'Musculus vastus intermedius', sys: 'muscles' },
  'biceps femoris': { fr: 'Biceps fémoral', g: 'm', la: 'Musculus biceps femoris', sys: 'muscles' },
  semitendinosus: { fr: 'Semi-tendineux', g: 'm', la: 'Musculus semitendinosus', sys: 'muscles' },
  semimembranosus: { fr: 'Semi-membraneux', g: 'm', la: 'Musculus semimembranosus', sys: 'muscles' },
  'tensor fasciae latae': { fr: 'Tenseur du fascia lata', g: 'm', la: 'Musculus tensor fasciae latae', sys: 'muscles' },
  'iliotibial tract': { fr: 'Tractus ilio-tibial', g: 'm', la: 'Tractus iliotibialis', sys: 'muscles' },

  // -------------------------------------------------- muscles — jambe/pied
  gastrocnemius: { fr: 'Gastrocnémien', g: 'm', la: 'Musculus gastrocnemius', sys: 'muscles' },
  soleus: { fr: 'Soléaire', g: 'm', la: 'Musculus soleus', sys: 'muscles' },
  plantaris: { fr: 'Plantaire', g: 'm', la: 'Musculus plantaris', sys: 'muscles' },
  popliteus: { fr: 'Poplité', g: 'm', la: 'Musculus popliteus', sys: 'muscles' },
  'tibialis anterior': { fr: 'Tibial antérieur', g: 'm', la: 'Musculus tibialis anterior', sys: 'muscles' },
  'tibialis posterior': { fr: 'Tibial postérieur', g: 'm', la: 'Musculus tibialis posterior', sys: 'muscles' },
  'fibularis longus': { fr: 'Long fibulaire', g: 'm', la: 'Musculus fibularis longus', sys: 'muscles' },
  'fibularis brevis': { fr: 'Court fibulaire', g: 'm', la: 'Musculus fibularis brevis', sys: 'muscles' },
  'fibularis tertius': { fr: 'Troisième fibulaire', g: 'm', la: 'Musculus fibularis tertius', sys: 'muscles' },
  'extensor digitorum longus': { fr: 'Long extenseur des orteils', g: 'm', la: 'Musculus extensor digitorum longus', sys: 'muscles' },
  'extensor digitorum brevis': { fr: 'Court extenseur des orteils', g: 'm', la: 'Musculus extensor digitorum brevis', sys: 'muscles' },
  'extensor hallucis longus': { fr: 'Long extenseur de l’hallux', g: 'm', la: 'Musculus extensor hallucis longus', sys: 'muscles' },
  'extensor hallucis brevis': { fr: 'Court extenseur de l’hallux', g: 'm', la: 'Musculus extensor hallucis brevis', sys: 'muscles' },
  'flexor digitorum longus': { fr: 'Long fléchisseur des orteils', g: 'm', la: 'Musculus flexor digitorum longus', sys: 'muscles' },
  'flexor digitorum brevis': { fr: 'Court fléchisseur des orteils', g: 'm', la: 'Musculus flexor digitorum brevis', sys: 'muscles' },
  'flexor hallucis longus': { fr: 'Long fléchisseur de l’hallux', g: 'm', la: 'Musculus flexor hallucis longus', sys: 'muscles' },
  'flexor hallucis brevis': { fr: 'Court fléchisseur de l’hallux', g: 'm', la: 'Musculus flexor hallucis brevis', sys: 'muscles' },
  'abductor hallucis': { fr: 'Abducteur de l’hallux', g: 'm', la: 'Musculus abductor hallucis', sys: 'muscles' },
  'adductor hallucis': { fr: 'Adducteur de l’hallux', g: 'm', la: 'Musculus adductor hallucis', sys: 'muscles' },
  'abductor digiti minimi of foot': { fr: 'Abducteur du petit orteil', g: 'm', la: 'Musculus abductor digiti minimi pedis', sys: 'muscles' },
  'flexor digiti minimi brevis of foot': { fr: 'Court fléchisseur du petit orteil', g: 'm', la: 'Musculus flexor digiti minimi brevis', sys: 'muscles' },
  'opponens digiti minimi of foot': { fr: 'Opposant du petit orteil', g: 'm', la: 'Musculus opponens digiti minimi', sys: 'muscles' },
  'flexor accessorius': { fr: 'Carré plantaire', g: 'm', la: 'Musculus quadratus plantae', sys: 'muscles' },
  'dorsal interossei of foot': { fr: 'Interosseux dorsaux du pied', g: 'm', la: 'Musculi interossei dorsales pedis', sys: 'muscles' },
  'calcaneal tendon': { fr: 'Tendon calcanéen', g: 'm', la: 'Tendo calcaneus', sys: 'muscles' },
  'long plantar ligament': { fr: 'Ligament plantaire long', g: 'm', la: 'Ligamentum plantare longum', sys: 'squelette' },
  'interosseous membrane of leg': { fr: 'Membrane interosseuse de la jambe', g: 'f', la: 'Membrana interossea cruris', sys: 'squelette' },

  // ----------------------------------------------------- muscles — tronc/dos
  diaphragm: { fr: 'Diaphragme', g: 'm', la: 'Diaphragma', sys: 'muscles' },
  'rectus abdominis': { fr: 'Droit de l’abdomen', g: 'm', la: 'Musculus rectus abdominis', sys: 'muscles' },
  'external oblique': { fr: 'Oblique externe', g: 'm', la: 'Musculus obliquus externus abdominis', sys: 'muscles' },
  'internal oblique': { fr: 'Oblique interne', g: 'm', la: 'Musculus obliquus internus abdominis', sys: 'muscles' },
  'transversus abdominis': { fr: 'Transverse de l’abdomen', g: 'm', la: 'Musculus transversus abdominis', sys: 'muscles' },
  'transversus thoracis': { fr: 'Transverse du thorax', g: 'm', la: 'Musculus transversus thoracis', sys: 'muscles' },
  pyramidalis: { fr: 'Pyramidal', g: 'm', la: 'Musculus pyramidalis', sys: 'muscles' },
  'quadratus lumborum': { fr: 'Carré des lombes', g: 'm', la: 'Musculus quadratus lumborum', sys: 'muscles' },
  'linea alba': { fr: 'Ligne blanche', g: 'f', la: 'Linea alba', sys: 'muscles' },
  'inguinal ligament': { fr: 'Ligament inguinal', g: 'm', la: 'Ligamentum inguinale', sys: 'squelette' },
  'external intercostal muscle': { fr: 'Intercostal externe', g: 'm', la: 'Musculus intercostalis externus', sys: 'muscles' },
  'internal intercostal muscle': { fr: 'Intercostal interne', g: 'm', la: 'Musculus intercostalis internus', sys: 'muscles' },
  'innermost intercostal muscle': { fr: 'Intercostal intime', g: 'm', la: 'Musculus intercostalis intimus', sys: 'muscles' },
  'serratus posterior superior': { fr: 'Dentelé postéro-supérieur', g: 'm', la: 'Musculus serratus posterior superior', sys: 'muscles' },
  'serratus posterior inferior': { fr: 'Dentelé postéro-inférieur', g: 'm', la: 'Musculus serratus posterior inferior', sys: 'muscles' },
  'levatores costarum breves': { fr: 'Élévateurs courts des côtes', g: 'm', la: 'Musculi levatores costarum breves', sys: 'muscles' },
  'levatores costarum longi': { fr: 'Élévateurs longs des côtes', g: 'm', la: 'Musculi levatores costarum longi', sys: 'muscles' },
  multifidus: { fr: 'Multifide', g: 'm', la: 'Musculus multifidus', sys: 'muscles' },
  'lumbar rotator': { fr: 'Rotateur lombaire', g: 'm', la: 'Musculi rotatores lumborum', sys: 'muscles' },
  'thoracic rotator': { fr: 'Rotateur thoracique', g: 'm', la: 'Musculi rotatores thoracis', sys: 'muscles' },
  'iliocostalis cervicis': { fr: 'Ilio-costal cervical', g: 'm', la: 'Musculus iliocostalis cervicis', sys: 'muscles' },
  'iliocostalis thoracis': { fr: 'Ilio-costal thoracique', g: 'm', la: 'Musculus iliocostalis thoracis', sys: 'muscles' },
  'iliocostalis lumborum': { fr: 'Ilio-costal lombaire', g: 'm', la: 'Musculus iliocostalis lumborum', sys: 'muscles' },
  'longissimus capitis': { fr: 'Longissimus de la tête', g: 'm', la: 'Musculus longissimus capitis', sys: 'muscles' },
  'longissimus cervicis': { fr: 'Longissimus cervical', g: 'm', la: 'Musculus longissimus cervicis', sys: 'muscles' },
  'longissimus thoracis': { fr: 'Longissimus thoracique', g: 'm', la: 'Musculus longissimus thoracis', sys: 'muscles' },
  'spinalis cervicis': { fr: 'Épineux cervical', g: 'm', la: 'Musculus spinalis cervicis', sys: 'muscles' },
  'spinalis thoracis': { fr: 'Épineux thoracique', g: 'm', la: 'Musculus spinalis thoracis', sys: 'muscles' },
  'semispinalis capitis': { fr: 'Semi-épineux de la tête', g: 'm', la: 'Musculus semispinalis capitis', sys: 'muscles' },
  'semispinalis cervicis': { fr: 'Semi-épineux cervical', g: 'm', la: 'Musculus semispinalis cervicis', sys: 'muscles' },
  'semispinalis thoracis': { fr: 'Semi-épineux thoracique', g: 'm', la: 'Musculus semispinalis thoracis', sys: 'muscles' },
  'splenius capitis': { fr: 'Splénius de la tête', g: 'm', la: 'Musculus splenius capitis', sys: 'muscles' },
  'splenius cervicis': { fr: 'Splénius du cou', g: 'm', la: 'Musculus splenius cervicis', sys: 'muscles' },
  'interspinales cervicis': { fr: 'Interépineux cervicaux', g: 'm', la: 'Musculi interspinales cervicis', sys: 'muscles' },
  'interspinales thoracis': { fr: 'Interépineux thoraciques', g: 'm', la: 'Musculi interspinales thoracis', sys: 'muscles' },
  'interspinales lumborum': { fr: 'Interépineux lombaires', g: 'm', la: 'Musculi interspinales lumborum', sys: 'muscles' },
  'lateral lumbar intertransversarius muscles': { fr: 'Intertransversaires lombaires latéraux', g: 'm', la: null, sys: 'muscles' },
  'medial lumbar intertransversarius muscles': { fr: 'Intertransversaires lombaires médiaux', g: 'm', la: null, sys: 'muscles' },
  // — plancher pelvien
  coccygeus: { fr: 'Coccygien', g: 'm', la: 'Musculus coccygeus', sys: 'muscles' },
  iliococcygeus: { fr: 'Ilio-coccygien', g: 'm', la: 'Musculus iliococcygeus', sys: 'muscles' },
  pubococcygeus: { fr: 'Pubo-coccygien', g: 'm', la: 'Musculus pubococcygeus', sys: 'muscles' },
  puborectalis: { fr: 'Pubo-rectal', g: 'm', la: 'Musculus puborectalis', sys: 'muscles' },
  'external anal sphincter': { fr: 'Sphincter anal externe', g: 'm', la: 'Musculus sphincter ani externus', sys: 'muscles' },
  'tendinous arch of levator ani': { fr: 'Arc tendineux du releveur de l’anus', g: 'm', la: 'Arcus tendineus musculi levatoris ani', sys: 'muscles' },
});

/* ==========================================================================
 * VAISSEAUX, ORGANES, STRUCTURES CÉRÉBRALES
 * ==========================================================================
 * Le suffixe « , nsn » de la source (« not specified name ») marque un
 * libellé non normalisé côté BodyParts3D ; il est conservé dans la clé mais
 * n'apparaît jamais à l'écran.
 */
Object.assign(TERMS, {
  // ------------------------------------------------------------- artères
  'ascending aorta': { fr: 'Aorte ascendante', g: 'f', la: 'Aorta ascendens', sys: 'vaisseaux' },
  'arch of aorta': { fr: 'Arc aortique', g: 'm', la: 'Arcus aortae', sys: 'vaisseaux' },
  'descending aorta': { fr: 'Aorte descendante', g: 'f', la: 'Aorta descendens', sys: 'vaisseaux' },
  'brachiocephalic artery, nsn': { fr: 'Tronc brachio-céphalique', g: 'm', la: 'Truncus brachiocephalicus', sys: 'vaisseaux' },
  'subclavian artery': { fr: 'Artère subclavière', g: 'f', la: 'Arteria subclavia', sys: 'vaisseaux' },
  'pulmonary artery': { fr: 'Artère pulmonaire', g: 'f', la: 'Arteria pulmonalis', sys: 'vaisseaux' },
  'celiac artery': { fr: 'Tronc cœliaque', g: 'm', la: 'Truncus coeliacus', sys: 'vaisseaux' },
  'common hepatic artery': { fr: 'Artère hépatique commune', g: 'f', la: 'Arteria hepatica communis', sys: 'vaisseaux' },
  'gastric artery': { fr: 'Artère gastrique', g: 'f', la: 'Arteria gastrica', sys: 'vaisseaux' },
  'splenic artery': { fr: 'Artère splénique', g: 'f', la: 'Arteria splenica', sys: 'vaisseaux' },
  'renal artery': { fr: 'Artère rénale', g: 'f', la: 'Arteria renalis', sys: 'vaisseaux' },
  'superior mesenteric artery': { fr: 'Artère mésentérique supérieure', g: 'f', la: 'Arteria mesenterica superior', sys: 'vaisseaux' },
  'inferior mesenteric artery': { fr: 'Artère mésentérique inférieure', g: 'f', la: 'Arteria mesenterica inferior', sys: 'vaisseaux' },
  'common iliac artery': { fr: 'Artère iliaque commune', g: 'f', la: 'Arteria iliaca communis', sys: 'vaisseaux' },
  'external iliac artery': { fr: 'Artère iliaque externe', g: 'f', la: 'Arteria iliaca externa', sys: 'vaisseaux' },
  'internal iliac artery': { fr: 'Artère iliaque interne', g: 'f', la: 'Arteria iliaca interna', sys: 'vaisseaux' },
  'stem of left coronary artery': { fr: 'Tronc de l’artère coronaire gauche', g: 'm', la: 'Arteria coronaria sinistra', sys: 'vaisseaux' },
  'trunk of right coronary artery': { fr: 'Tronc de l’artère coronaire droite', g: 'm', la: 'Arteria coronaria dextra', sys: 'vaisseaux' },
  'anterior interventricular branch of left coronary artery, nsn': { fr: 'Artère interventriculaire antérieure', g: 'f', la: 'Ramus interventricularis anterior', sys: 'vaisseaux' },
  'posterior interventricular branch of right coronary artery, nsn': { fr: 'Artère interventriculaire postérieure', g: 'f', la: 'Ramus interventricularis posterior', sys: 'vaisseaux' },
  'circumflex branch of left coronary artery': { fr: 'Artère circonflexe', g: 'f', la: 'Ramus circumflexus', sys: 'vaisseaux' },
  'marginal branch of right coronary artery': { fr: 'Branche marginale droite', g: 'f', la: 'Ramus marginalis dexter', sys: 'vaisseaux' },
  'posterolateral branch of right coronary artery': { fr: 'Branche postéro-latérale droite', g: 'f', la: null, sys: 'vaisseaux' },
  'interventricular septal branches of left coronary artery': { fr: 'Branches septales (coronaire gauche)', g: 'f', la: 'Rami interventriculares septales', sys: 'vaisseaux' },
  'interventricular septal branches of right coronary artery': { fr: 'Branches septales (coronaire droite)', g: 'f', la: 'Rami interventriculares septales', sys: 'vaisseaux' },

  // -------------------------------------------------------------- veines
  'superior vena cava': { fr: 'Veine cave supérieure', g: 'f', la: 'Vena cava superior', sys: 'vaisseaux' },
  'inferior vena cava': { fr: 'Veine cave inférieure', g: 'f', la: 'Vena cava inferior', sys: 'vaisseaux' },
  'brachiocephalic vein': { fr: 'Veine brachio-céphalique', g: 'f', la: 'Vena brachiocephalica', sys: 'vaisseaux' },
  'subclavian vein': { fr: 'Veine subclavière', g: 'f', la: 'Vena subclavia', sys: 'vaisseaux' },
  'pulmonary vein': { fr: 'Veine pulmonaire', g: 'f', la: 'Vena pulmonalis', sys: 'vaisseaux' },
  'renal vein': { fr: 'Veine rénale', g: 'f', la: 'Vena renalis', sys: 'vaisseaux' },
  'splenic vein': { fr: 'Veine splénique', g: 'f', la: 'Vena splenica', sys: 'vaisseaux' },
  'superior mesenteric vein': { fr: 'Veine mésentérique supérieure', g: 'f', la: 'Vena mesenterica superior', sys: 'vaisseaux' },
  'common iliac vein': { fr: 'Veine iliaque commune', g: 'f', la: 'Vena iliaca communis', sys: 'vaisseaux' },
  'external iliac vein': { fr: 'Veine iliaque externe', g: 'f', la: 'Vena iliaca externa', sys: 'vaisseaux' },
  'internal iliac vein': { fr: 'Veine iliaque interne', g: 'f', la: 'Vena iliaca interna', sys: 'vaisseaux' },
  'great cardiac vein': { fr: 'Grande veine cardiaque', g: 'f', la: 'Vena cardiaca magna', sys: 'vaisseaux' },
  'middle cardiac vein': { fr: 'Veine cardiaque moyenne', g: 'f', la: 'Vena cardiaca media', sys: 'vaisseaux' },
  'anterior cardiac veins': { fr: 'Veines cardiaques antérieures', g: 'f', la: 'Venae cardiacae anteriores', sys: 'vaisseaux' },
  'posterior veins of left ventricle': { fr: 'Veines postérieures du ventricule gauche', g: 'f', la: null, sys: 'vaisseaux' },
  'coronary sinus': { fr: 'Sinus coronaire', g: 'm', la: 'Sinus coronarius', sys: 'vaisseaux' },

  // --------------------------------------------------------------- cœur
  'wall of heart': { fr: 'Paroi du cœur', g: 'f', la: 'Paries cordis', sys: 'organes' },
  'mitral valve': { fr: 'Valve mitrale', g: 'f', la: 'Valva mitralis', sys: 'organes' },
  'tricuspid valve': { fr: 'Valve tricuspide', g: 'f', la: 'Valva tricuspidalis', sys: 'organes' },
  'pulmonary valve': { fr: 'Valve pulmonaire', g: 'f', la: 'Valva trunci pulmonalis', sys: 'organes' },
  'anterior papillary muscle of right ventricle': { fr: 'Muscle papillaire antérieur (VD)', g: 'm', la: 'Musculus papillaris anterior', sys: 'organes' },
  'posterior papillary muscle of right ventricle': { fr: 'Muscle papillaire postérieur (VD)', g: 'm', la: 'Musculus papillaris posterior', sys: 'organes' },
  'posterior papillary muscle of left ventricle': { fr: 'Muscle papillaire postérieur (VG)', g: 'm', la: 'Musculus papillaris posterior', sys: 'organes' },
  'septal papillary muscle of right ventricle': { fr: 'Muscle papillaire septal (VD)', g: 'm', la: 'Musculus papillaris septalis', sys: 'organes' },
  'papillary muscle of left ventricle, nsn': { fr: 'Muscle papillaire (VG)', g: 'm', la: 'Musculus papillaris', sys: 'organes' },

  // ------------------------------------------------------------- viscères
  liver: { fr: 'Foie', g: 'm', la: 'Hepar', sys: 'organes' },
  stomach: { fr: 'Estomac', g: 'm', la: 'Gaster', sys: 'organes' },
  spleen: { fr: 'Rate', g: 'f', la: 'Splen', sys: 'organes' },
  'pancreas, nsn': { fr: 'Pancréas', g: 'm', la: 'Pancreas', sys: 'organes' },
  'pancreatic duct': { fr: 'Conduit pancréatique', g: 'm', la: 'Ductus pancreaticus', sys: 'organes' },
  gallbladder: { fr: 'Vésicule biliaire', g: 'f', la: 'Vesica biliaris', sys: 'organes' },
  duodenum: { fr: 'Duodénum', g: 'm', la: 'Duodenum', sys: 'organes' },
  jejunum: { fr: 'Jéjunum', g: 'm', la: 'Jejunum', sys: 'organes' },
  ileum: { fr: 'Iléon', g: 'm', la: 'Ileum', sys: 'organes' },
  'colon, nsn': { fr: 'Côlon', g: 'm', la: 'Colon', sys: 'organes' },
  rectum: { fr: 'Rectum', g: 'm', la: 'Rectum', sys: 'organes' },
  appendix: { fr: 'Appendice', g: 'm', la: 'Appendix vermiformis', sys: 'organes' },
  'free taenia': { fr: 'Ténia libre', g: 'm', la: 'Taenia libera', sys: 'organes' },
  'mesocolic taenia': { fr: 'Ténia mésocolique', g: 'm', la: 'Taenia mesocolica', sys: 'organes' },
  'omental taenia': { fr: 'Ténia omentale', g: 'm', la: 'Taenia omentalis', sys: 'organes' },
  kidney: { fr: 'Rein', g: 'm', la: 'Ren', sys: 'organes' },
  ureter: { fr: 'Uretère', g: 'm', la: 'Ureter', sys: 'organes' },
  urethra: { fr: 'Urètre', g: 'm', la: 'Urethra', sys: 'organes' },
  'urinary bladder': { fr: 'Vessie', g: 'f', la: 'Vesica urinaria', sys: 'organes' },
  'adrenal gland': { fr: 'Glande surrénale', g: 'f', la: 'Glandula suprarenalis', sys: 'organes' },
  prostate: { fr: 'Prostate', g: 'f', la: 'Prostata', sys: 'organes' },
  testis: { fr: 'Testicule', g: 'm', la: 'Testis', sys: 'organes' },
  epididymis: { fr: 'Épididyme', g: 'm', la: 'Epididymis', sys: 'organes' },
  'deferent duct': { fr: 'Conduit déférent', g: 'm', la: 'Ductus deferens', sys: 'organes' },
  'seminal vesicle': { fr: 'Vésicule séminale', g: 'f', la: 'Vesicula seminalis', sys: 'organes' },
  'glans penis': { fr: 'Gland', g: 'm', la: 'Glans penis', sys: 'organes' },
  'corpus cavernosum of penis': { fr: 'Corps caverneux', g: 'm', la: 'Corpus cavernosum penis', sys: 'organes' },
  'corpus spongiosum of penis, nsn': { fr: 'Corps spongieux', g: 'm', la: 'Corpus spongiosum penis', sys: 'organes' },
  bronchus: { fr: 'Bronche', g: 'f', la: 'Bronchus', sys: 'organes' },
  'upper lobe of left lung': { fr: 'Lobe supérieur du poumon gauche', g: 'm', la: 'Lobus superior', sys: 'organes' },
  'lower lobe of left lung': { fr: 'Lobe inférieur du poumon gauche', g: 'm', la: 'Lobus inferior', sys: 'organes' },
  'upper lobe of right lung': { fr: 'Lobe supérieur du poumon droit', g: 'm', la: 'Lobus superior', sys: 'organes' },
  'middle lobe of lung': { fr: 'Lobe moyen du poumon droit', g: 'm', la: 'Lobus medius', sys: 'organes' },
  'lower lobe of right lung': { fr: 'Lobe inférieur du poumon droit', g: 'm', la: 'Lobus inferior', sys: 'organes' },
  'lobe of thymus': { fr: 'Lobe du thymus', g: 'm', la: 'Lobus thymi', sys: 'organes' },
  skin: { fr: 'Peau', g: 'f', la: 'Cutis', sys: 'organes' },
  'head hairs': { fr: 'Cheveux', g: 'm', la: 'Capilli', sys: 'organes' },
  'pubic hairs': { fr: 'Poils pubiens', g: 'm', la: 'Pubes', sys: 'organes' },

  // ------------------------------------------------- structures cérébrales
  'corpus callosum': { fr: 'Corps calleux', g: 'm', la: 'Corpus callosum', sys: 'nerfs' },
  'internal capsule': { fr: 'Capsule interne', g: 'f', la: 'Capsula interna', sys: 'nerfs' },
  'fornix of forebrain': { fr: 'Fornix', g: 'm', la: 'Fornix', sys: 'nerfs' },
  'commissure of fornix of forebrain': { fr: 'Commissure du fornix', g: 'f', la: 'Commissura fornicis', sys: 'nerfs' },
  'anterior commissure': { fr: 'Commissure antérieure', g: 'f', la: 'Commissura anterior', sys: 'nerfs' },
  'posterior commissure': { fr: 'Commissure postérieure', g: 'f', la: 'Commissura posterior', sys: 'nerfs' },
  'stria medullaris of thalamus': { fr: 'Strie médullaire du thalamus', g: 'f', la: 'Stria medullaris thalami', sys: 'nerfs' },
  'stria terminalis': { fr: 'Strie terminale', g: 'f', la: 'Stria terminalis', sys: 'nerfs' },
  'mammillary body': { fr: 'Corps mamillaire', g: 'm', la: 'Corpus mammillare', sys: 'nerfs' },
  'lamina terminalis': { fr: 'Lame terminale', g: 'f', la: 'Lamina terminalis', sys: 'nerfs' },
  'interpeduncular fossa': { fr: 'Fosse interpédonculaire', g: 'f', la: 'Fossa interpeduncularis', sys: 'nerfs' },
  'interventricular foramen': { fr: 'Foramen interventriculaire', g: 'm', la: 'Foramen interventriculare', sys: 'nerfs' },
  'central canal of spinal cord': { fr: 'Canal central de la moelle', g: 'm', la: 'Canalis centralis', sys: 'nerfs' },
  'choroid plexus of left cerebral hemisphere': { fr: 'Plexus choroïde (hémisphère gauche)', g: 'm', la: 'Plexus choroideus', sys: 'nerfs' },
  'choroid plexus of right cerebral hemisphere': { fr: 'Plexus choroïde (hémisphère droit)', g: 'm', la: 'Plexus choroideus', sys: 'nerfs' },
  'white matter structure of cerebral hemisphere': { fr: 'Substance blanche hémisphérique', g: 'f', la: 'Substantia alba', sys: 'nerfs' },
});
