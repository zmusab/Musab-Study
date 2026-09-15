import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Point d'entrée UNIQUE pour la configuration du worker pdf.js.
 *
 * `extract.ts` et `render.ts` en ont chacun besoin ; sans ce module partagé,
 * chacun importait indépendamment `pdf.worker.min.mjs?url`, et le bundler
 * produisait deux copies distinctes de ce fichier de ~1,4 Mo au lieu d'une
 * seule ressource lazy partagée.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
