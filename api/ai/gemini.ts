import { jsonResponse } from './_shared.js';

export const config = { runtime: 'edge' };

/** Old installed clients receive an explicit retirement response. No provider call. */
export default async function handler(_request?: Request): Promise<Response> {
  return jsonResponse({ error: 'provider_removed', message: 'Ce fournisseur a été retiré. Utilise le tuteur local.' }, 410);
}
