import { afterEach, describe, it, expect } from 'vitest';
import { getWorkspaceId, setApiKey, setWorkspaceId } from '@/services/ai/settings';

/**
 * Clés Anthropic « liées à une identité » — le cas observé en production :
 * l'API répond 400 « anthropic-workspace-id is required when authenticating
 * with an identity-linked API key », un message en anglais qui parle d'un
 * en-tête HTTP et ne dit pas quoi faire. L'espace de travail est donc
 * désormais saisissable dans Paramètres, envoyé en en-tête quand il existe,
 * et cette erreur précise est traduite en consigne actionnable.
 */

afterEach(() => {
  setWorkspaceId(null);
  setApiKey(null);
});

describe('réglage de l’espace de travail Anthropic', () => {
  it('absent par défaut — une clé rattachée à un espace de travail n’a rien à saisir', () => {
    expect(getWorkspaceId()).toBeNull();
  });

  it('conserve l’identifiant saisi, espaces superflus retirés', () => {
    setWorkspaceId('  wrkspc_exemple  ');
    expect(getWorkspaceId()).toBe('wrkspc_exemple');
  });

  it('une valeur vide ou blanche équivaut à « non renseigné », jamais à un en-tête vide', () => {
    setWorkspaceId('   ');
    expect(getWorkspaceId()).toBeNull();
    setWorkspaceId('');
    expect(getWorkspaceId()).toBeNull();
  });

  it('se retire complètement', () => {
    setWorkspaceId('wrkspc_exemple');
    setWorkspaceId(null);
    expect(getWorkspaceId()).toBeNull();
  });
});

describe('describeAnthropicError — l’erreur d’espace de travail devient une consigne', () => {
  /**
   * Reproduit la forme d'erreur du SDK sans dépendre de son constructeur
   * interne : `describeAnthropicError` ne regarde que `instanceof
   * Anthropic.APIError`, son `status` et son `message`.
   */
  async function describeWorkspaceError(): Promise<string> {
    const [{ describeAnthropicError }, { default: Anthropic }] = await Promise.all([
      import('@/services/ai/providers/anthropic'),
      import('@anthropic-ai/sdk'),
    ]);
    const error = new Anthropic.APIError(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'anthropic-workspace-id is required when authenticating with an identity-linked API key; send the id of the workspace this request acts in.',
        },
      },
      undefined,
      undefined,
    );
    return describeAnthropicError(error);
  }

  it('sans espace de travail renseigné, dit exactement où le régler', async () => {
    const message = await describeWorkspaceError();
    expect(message).toMatch(/Workspace ID/);
    expect(message).toMatch(/Paramètres/);
    // Jamais le message brut de l'API, en anglais et centré sur un en-tête HTTP.
    expect(message).not.toContain('identity-linked');
  });

  it('avec un espace de travail déjà renseigné, oriente vers sa vérification', async () => {
    setWorkspaceId('wrkspc_exemple');
    const message = await describeWorkspaceError();
    expect(message).toMatch(/refusé|Vérifie/);
    expect(message).toMatch(/Workspace ID/);
  });
});

/**
 * Anthropic répond 400 — et non 402 — quand le solde est épuisé. Le message
 * brut est en anglais et ressemble à un refus de requête : confondu avec une
 * mauvaise clé, il envoie recréer une clé qui fonctionne parfaitement.
 */
describe('describeAnthropicError — un solde épuisé n’est pas une mauvaise clé', () => {
  it('nomme les crédits et rassure sur la validité de la clé', async () => {
    const [{ describeAnthropicError }, { default: Anthropic }] = await Promise.all([
      import('@/services/ai/providers/anthropic'),
      import('@anthropic-ai/sdk'),
    ]);
    const error = new Anthropic.APIError(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Your credit balance is too low to access the Anthropic API.',
        },
      },
      undefined,
      undefined,
    );

    const message = describeAnthropicError(error);
    expect(message).toMatch(/[Cc]rédits/);
    expect(message).toMatch(/clé, elle, reste valide|reste valide/);
    expect(message).not.toContain('credit balance');
  });
});
