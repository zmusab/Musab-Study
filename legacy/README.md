# Prototype d'origine (v0)

`prototype-v0.html` est le prototype fonctionnel d'origine de Musab Study,
préservé **tel quel** comme référence et comme filet de sécurité.

⚠️ Ce fichier ne doit jamais être modifié. Il sert de :
- référence fonctionnelle (comportement attendu de chaque écran) ;
- point de restauration en cas de problème sur la nouvelle application.

## Dépendances d'exécution du prototype

Ce fichier ne s'exécute **complètement** que dans l'environnement d'exécution
des Artifacts Claude, car il dépend de deux API fournies par cet environnement :

1. `window.storage` — persistance (toute la sauvegarde en dépend) ;
2. `fetch("https://api.anthropic.com/v1/messages")` **sans clé API** —
   l'environnement injecte l'authentification côté hôte.

Ouvert dans Safari/Chrome normalement, l'interface s'affiche mais :
- rien n'est sauvegardé (`window.storage` est indéfini, les erreurs sont avalées) ;
- toutes les fonctions IA échouent (401 sans clé).

C'est précisément ce que la nouvelle application corrige.
