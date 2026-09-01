/**
 * Rattachement RÉGION / SOUS-RÉGION / SYSTÈME, dérivé de l'arbre d'inclusion
 * officiel de BodyParts3D — jamais d'une liste tenue à la main.
 *
 * Chaque structure est rattachée à la sous-région la PLUS SPÉCIFIQUE qui la
 * contient : les régions se chevauchent dans la source (le tronc contient le
 * thorax, qui contient les côtes), donc l'ordre de ce tableau fait foi et va
 * du plus précis au plus général.
 */

/** Sous-régions, du plus spécifique au plus général. `root` = libellé anglais dans l'arbre. */
export const SUBREGION_ROOTS = [
  // ---- Tête et cou (déjà exploité ; l'ordre interne vient de headNeck) ----
  { id: 'encephale', region: 'tete-et-cou', root: 'brain', label: 'Encéphale', icon: '🧠', lazy: true },
  { id: 'orbite', region: 'tete-et-cou', root: 'orbital content', label: 'Orbite', icon: '👁️' },
  { id: 'crane', region: 'tete-et-cou', root: 'skull', label: 'Crâne', icon: '🦴' },
  { id: 'face', region: 'tete-et-cou', root: 'face', label: 'Face', icon: '🙂' },
  { id: 'cou', region: 'tete-et-cou', root: 'neck', label: 'Cou', icon: '⬇️' },

  // ---- Membre supérieur ----
  { id: 'main', region: 'membre-superieur', root: 'hand', label: 'Main', icon: '✋' },
  { id: 'poignet', region: 'membre-superieur', root: 'wrist', label: 'Poignet', icon: '🦴' },
  { id: 'avant-bras', region: 'membre-superieur', root: 'forearm', label: 'Avant-bras', icon: '💪' },
  { id: 'coude', region: 'membre-superieur', root: 'elbow', label: 'Coude', icon: '🦴' },
  { id: 'bras', region: 'membre-superieur', root: 'arm', label: 'Bras', icon: '💪' },
  { id: 'epaule', region: 'membre-superieur', root: 'pectoral girdle', label: 'Épaule', icon: '🦴' },

  // ---- Membre inférieur ----
  { id: 'pied', region: 'membre-inferieur', root: 'foot', label: 'Pied', icon: '🦶' },
  { id: 'jambe', region: 'membre-inferieur', root: 'leg', label: 'Jambe', icon: '🦵' },
  { id: 'genou', region: 'membre-inferieur', root: 'knee', label: 'Genou', icon: '🦴' },
  { id: 'cuisse', region: 'membre-inferieur', root: 'thigh', label: 'Cuisse', icon: '🦵' },
  { id: 'hanche', region: 'membre-inferieur', root: 'pelvic girdle', label: 'Hanche', icon: '🦴' },

  // ---- Tronc ----
  { id: 'thorax', region: 'tronc', root: 'thorax', label: 'Thorax', icon: '🫁' },
  { id: 'abdomen', region: 'tronc', root: 'abdomen', label: 'Abdomen', icon: '🩻' },
  { id: 'bassin', region: 'tronc', root: 'pelvis', label: 'Bassin', icon: '🦴' },
  { id: 'dos', region: 'tronc', root: 'back', label: 'Dos', icon: '🦴' },
];

/** Régions de premier niveau, dans l'ordre d'affichage. */
export const REGIONS = [
  { id: 'tete-et-cou', label: 'Tête et cou', icon: '🧠' },
  { id: 'tronc', label: 'Tronc', icon: '🫁' },
  { id: 'membre-superieur', label: 'Membre supérieur', icon: '💪' },
  { id: 'membre-inferieur', label: 'Membre inférieur', icon: '🦵' },
];

/**
 * Rattachements par nom pour les structures qu'aucune région de l'arbre ne
 * contient (cartilages costaux, membranes interosseuses…). Chaque motif est
 * vérifié contre le libellé source, pas deviné à l'affichage.
 */
export const FALLBACK_BY_LABEL = [
  { match: /costal cartilage/i, subregion: 'thorax' },
  { match: /interosseous membrane of (right|left) forearm/i, subregion: 'avant-bras' },
  { match: /interosseous membrane of (right|left) leg/i, subregion: 'jambe' },
  { match: /\b(rib|sternum|manubrium|xiphoid)\b/i, subregion: 'thorax' },
  { match: /thoracic vertebra|intervertebral disk of .*thoracic/i, subregion: 'thorax' },
  { match: /lumbar vertebra|intervertebral disk of .*lumbar|sacrum|coccyx/i, subregion: 'bassin' },
  { match: /cervical vertebra|intervertebral disk of .*cervical|atlas|axis/i, subregion: 'cou' },
  { match: /clavicle|scapula/i, subregion: 'epaule' },
  { match: /\b(humerus)\b/i, subregion: 'bras' },
  { match: /\b(radius|ulna)\b/i, subregion: 'avant-bras' },
  { match: /\b(femur|patella)\b/i, subregion: 'cuisse' },
  { match: /\b(tibia|fibula)\b/i, subregion: 'jambe' },
  { match: /\b(hip bone|ilium|ischium|pubis)\b/i, subregion: 'bassin' },
  { match: /tooth|gingiva|labial part of mouth/i, subregion: 'dents' },

  // Structures que l'arbre ne rattache à aucune région : chaque motif vise un
  // groupe anatomique précis, jamais un fourre-tout.
  // — encéphale
  { match: /corpus callosum|commissure|fornix|stria (medullaris|terminalis)|mammillary body|lamina terminalis|interpeduncular fossa|interventricular foramen|choroid plexus|internal capsule|white matter structure|central canal of spinal cord/i, subregion: 'encephale' },
  // — thorax (gros vaisseaux de la base, voies aériennes)
  { match: /aorta|pulmonary (artery|vein)|vena cava|brachiocephalic (artery|vein)|subclavian vein|bronchus|thymus/i, subregion: 'thorax' },
  // — abdomen (digestif et ses vaisseaux)
  { match: /celiac artery|hepatic artery|gastric artery|splenic (artery|vein)|mesenteric (artery|vein)|renal (artery|vein)|gallbladder|appendix|taenia|pancrea/i, subregion: 'abdomen' },
  // — bassin (iliaques, urogénital)
  { match: /iliac (artery|vein)|urethra|testis|epididymis|penis|glans|prostate|seminal vesicle|deferent duct/i, subregion: 'bassin' },
  // — avant-bras et main
  { match: /pronator quadratus|flexor digitorum (profundus|superficialis)|flexor pollicis longus/i, subregion: 'avant-bras' },
  { match: /interossei of (right |left )?hand|lumbricals of (right |left )?hand/i, subregion: 'main' },
  // — pied
  { match: /interossei of (right |left )?foot|long plantar ligament|sesamoid bone of|calcaneal tendon/i, subregion: 'pied' },
  { match: /iliotibial tract/i, subregion: 'cuisse' },
  { match: /intermediate tendon/i, subregion: 'cou' },
  // — tégument : couvre tout le corps, donc sa propre entrée plutôt qu'un
  //   rattachement arbitraire à une région.
  { match: /\bskin\b|hairs/i, subregion: 'tegument' },
];

/** Racines de système → catégorie affichée dans l'interface. */
export const SYSTEM_ROOTS = [
  { root: 'skeletal system', category: 'squelette' },
  { root: 'muscular system', category: 'muscles' },
  { root: 'nervous system', category: 'nerfs' },
  { root: 'cardiovascular system', category: 'vaisseaux' },
  { root: 'lymphoid system', category: 'vaisseaux' },
];

/** Sous-régions supplémentaires définies par le contenu, pas par l'arbre. */
export const EXTRA_SUBREGIONS = [
  { id: 'dents', region: 'tete-et-cou', label: 'Dents', icon: '🦷' },
  { id: 'machoire', region: 'tete-et-cou', label: 'Mâchoire et bouche', icon: '🦷' },
  { id: 'tegument', region: 'corps', label: 'Tégument', icon: '🧴' },
];
