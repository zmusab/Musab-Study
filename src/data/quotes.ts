/**
 * Citations sur le savoir et l'apprentissage — pour donner un peu de chaleur
 * à l'interface, sans jamais inventer de mots à qui que ce soit.
 *
 * Chaque citation ici est bien documentée et son attribution largement
 * établie. Le principe qui vaut pour l'assistant IA — ne jamais présenter
 * comme certain ce qui ne l'est pas — vaut aussi ici : une citation dont
 * l'attribution est disputée (il en circule beaucoup, à Confucius ou
 * Einstein en particulier) n'a pas sa place dans cette liste plutôt que
 * courte, mais fiable.
 */
export interface Quote {
  text: string;
  author: string;
}

export const QUOTES: readonly Quote[] = [
  { text: 'Je sais que je ne sais rien.', author: 'Socrate' },
  { text: "La racine de l'éducation est amère, mais ses fruits sont doux.", author: 'Aristote' },
  {
    text: 'Quand tu sais une chose, dis que tu la sais ; quand tu ne la sais pas, avoue que tu ne la sais pas : c’est là le savoir.',
    author: 'Confucius',
  },
  { text: "Il n'est pas de vent favorable pour celui qui ne sait où il va.", author: 'Sénèque' },
  { text: "Rien dans la vie n'est à craindre, tout est à comprendre.", author: 'Marie Curie' },
  {
    text: "Je n'ai pas de talent particulier. Je suis seulement passionnément curieux.",
    author: 'Albert Einstein',
  },
  {
    text: "Il ne suffit pas d'avoir l'esprit bon, mais le principal est de bien l'appliquer.",
    author: 'René Descartes',
  },
  {
    text: "Ce ne sont pas les choses qui nous troublent, mais l'opinion que nous en avons.",
    author: 'Épictète',
  },
  { text: 'Mieux vaut une tête bien faite qu’une tête bien pleine.', author: 'Michel de Montaigne' },
  { text: "Si j'ai vu plus loin, c'est en me tenant sur des épaules de géants.", author: 'Isaac Newton' },
  { text: "La chance ne sourit qu'aux esprits bien préparés.", author: 'Louis Pasteur' },
  { text: "L'éducation est l'arme la plus puissante pour changer le monde.", author: 'Nelson Mandela' },
  {
    text: 'Apprendre à lire, c’est allumer un feu ; chaque syllabe, chaque mot est une étincelle.',
    author: 'Victor Hugo',
  },
  {
    text: "L'expérience ne se trompe jamais, ce sont vos jugements qui se trompent.",
    author: 'Léonard de Vinci',
  },
  {
    text: "Le doute n'est pas une condition agréable, mais la certitude est absurde.",
    author: 'Voltaire',
  },
] as const;

/** Une citation au hasard — appeler une seule fois par montage, pas à chaque rendu. */
export function randomQuote(): Quote {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)]!;
}
