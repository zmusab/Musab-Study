# Musab Study

Environnement d'étude personnel — Dentisterie, section française, UMF Iași.

Cours, IA basée sur mes propres cours, flashcards, répétition espacée, quiz,
anatomie, calendrier, notes, recherche et progression.

---

## Démarrer

```bash
npm install
npm run dev          # http://localhost:5173/Musab-Study/
```

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Vérification TypeScript + build de production |
| `npm run preview` | Sert le build sur le port 4173 |
| `npm test` | Tests unitaires (Vitest) |
| `npm run test:e2e` | Test navigateur réel — nécessite `preview` en parallèle |
| `npm run verify` | Types + tests + build, à lancer avant chaque commit important |

## Architecture

Le principe : **le cœur métier ne connaît ni React, ni le DOM, ni IndexedDB.**
C'est ce qui le rend testable et ce qui rendra la migration vers un backend
contenue dans un seul dossier.

```
src/
├─ types/        Modèle de domaine — une interface par table
├─ core/         🧠 Logique métier pure, 100 % testée, zéro import UI
│  ├─ srs/         Répétition espacée (SM-2 modifié)
│  └─ mastery/     Maîtrise et statistiques
├─ data/         💾 Persistance
│  ├─ db.ts        Schéma IndexedDB (Dexie)
│  └─ repositories/  ← SEUL point à réécrire pour passer à Supabase
├─ services/     🔌 Services externes
│  ├─ ai/          Client Anthropic, réglages, vérification des citations
│  ├─ rag/         Découpage en fragments, tokenisation, récupération
│  ├─ backup.ts    Export / import
│  └─ legacyImport.ts  Migration depuis le prototype HTML
├─ components/   🎨 Interface
│  ├─ ui/          Boutons, champs, modales, notifications…
│  ├─ motion/      Primitives d'animation
│  └─ layout/      Structure et navigation
├─ pages/        Un écran par section
├─ hooks/        Accès réactifs aux données
└─ styles/       Jetons de design et thèmes
```

### Décisions structurantes

**Le stockage est relationnel, pas des gros blobs.** Le prototype stockait une
matière entière — texte intégral des PDF compris — sous une seule clé : noter
une carte réécrivait donc plusieurs mégaoctets. Ici chaque table est séparée et
indexée. Noter une carte n'écrit que cette carte.

**Local-first.** Les cours restent sur l'appareil, fonctionnent hors ligne, et
supportent des PDF volumineux. Le pattern repository isole ce choix.

**La garantie anti-hallucination est structurelle.** Les documents sont découpés
en fragments citables. Une réponse ne peut citer qu'un fragment réellement
transmis au modèle : une source absente du contexte ne peut pas être inventée.
Le prototype se reposait uniquement sur une consigne dans le prompt.

**Les animations n'animent que `opacity` et `transform`**, les seules propriétés
composées par le GPU. `prefers-reduced-motion` est respecté partout, et aucune
fonctionnalité ne dépend d'une animation pour fonctionner.

## Données et vie privée

Tout vit dans IndexedDB, sur l'appareil. Aucun serveur, aucun compte.

La clé API Anthropic est saisie dans **Paramètres** et conservée dans
`localStorage` de cet appareil uniquement. Elle n'est jamais commitée et n'est
pas incluse dans les sauvegardes.

> **Limite assumée :** en hébergement statique il n'existe aucun serveur où
> cacher un secret. La clé est donc lisible par le code de la page. Acceptable
> pour une application personnelle — à condition de ne pas y mettre une clé
> partagée, et de la révoquer si besoin depuis la console Anthropic.

## Déploiement

Deux hébergeurs statiques sont pris en charge, sans configuration supplémentaire :

- **GitHub Pages** — `.github/workflows/deploy.yml` construit et publie à chaque
  poussée. Nécessite un réglage manuel unique et ponctuel : Settings → Pages →
  Source : *GitHub Actions*.
- **Vercel** — `vercel.json` est prêt pour un import direct du dépôt. Le chemin
  de base est détecté automatiquement selon l'hébergeur (variable `VERCEL` ou
  `GITHUB_REPOSITORY`).

## Podcast d'étude

Transforme un cours en conversation à deux voix entre un étudiant qui
interroge et un étudiant qui explique, avec exemples cliniques fictifs
clairement identifiés comme tels, pièges à connaître, et mini-interrogation
finale.

Pipeline en quatre étapes, chacune vérifiable :
`Cours → Analyse (sélection des notions, sourcées) → Plan (durée choisie) →
Dialogue (sourcé phrase par phrase) → Validation (comme pour l'IA : une
réplique invérifiable n'est jamais présentée comme venant du cours)`.

La lecture audio utilise l'API native du navigateur (Web Speech API) — un vrai
son, sans clé ni coût supplémentaire, avec deux voix françaises distinctes
quand l'appareil en propose plusieurs. `services/tts/types.ts` définit
l'interface qu'un fournisseur cloud pourra implémenter plus tard sans changer
le lecteur ni le pipeline.

**Exporte régulièrement** depuis Paramètres : c'est la seule copie. L'import
accepte aussi les sauvegardes de l'ancien prototype HTML, historique de
révision compris.

## Le prototype d'origine

`legacy/prototype-v0.html` conserve le prototype initial, intact, comme
référence fonctionnelle et point de retour. Il n'est jamais modifié.

## Avancement

| Phase | Statut |
|---|---|
| 1. Analyse du prototype | ✅ |
| 2. Architecture et socle | ✅ |
| 3. Cours et documents | ✅ |
| 4. IA et RAG | ✅ |
| 5. Flashcards | ⏳ |
| 6. Répétition espacée | ⏳ |
| 7. Quiz | ⏳ |
| 8. Calendrier | ⏳ |
| 9. Dashboard | ⏳ |
| Podcast d'étude (hors ordre initial) | ✅ pipeline + lecteur, en attente des Phases 5-7 pour les intégrations complètes |
| 10. Notes et recherche | ⏳ |
| 11. Progression | ⏳ |
| 12. Anatomie | ⏳ |
| 13. PWA et iPad | ⏳ |
