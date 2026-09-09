import { useEffect, useState } from 'react';
import { Button, Card, CardSubtitle, CardTitle, Input, Select, useConfirm } from '@/components/ui';
import {
  getApiKey,
  getPreferredProvider,
  getWorkspaceId,
  hasApiKey,
  maskApiKey,
  setApiKey,
  setPreferredProvider,
  setWorkspaceId,
  type PreferredProvider,
} from '@/services/ai/settings';
import { PROVIDER_MODELS, getModelFor, modelStatusFor, setModelFor } from '@/services/ai/models';
import {
  CONFIGURABLE_TASKS,
  getAllTaskProviderPreferences,
  setTaskProviderPreference,
  type TaskProviderPreference,
} from '@/services/ai/taskPreferences';
import { proxyProviderStatus, refreshProviderStatus, type ProxyProviderId } from '@/services/ai/providerStatus';
import { aiOrchestrator, type ProviderTestResult } from '@/services/ai/orchestrator';
import { getTodayUsage } from '@/services/ai/usageStats';
import { clearAiCache, countCacheEntries } from '@/services/ai/cache';
import type { AITask, ProviderId } from '@/services/ai/types';
import type { AiUsageDay } from '@/types';

/**
 * RÉGLAGES IA — une seule carte, deux niveaux de lecture.
 *
 * Ce qu'un étudiant a besoin de régler tient en haut : quel assistant, quel
 * modèle, et est-ce que ça marche. Tout ce qui relève du fonctionnement
 * interne (clé, espace de travail, fournisseur par fonctionnalité, limites
 * techniques de chaque service) est replié dans « Avancé » — présent, mais
 * plus imposé.
 *
 * Remplace les deux cartes précédentes (« Assistant IA » et « Hub IA »), qui
 * affichaient ensemble une clé, un modèle, cinq états, deux boutons et neuf
 * sélecteurs de fournisseur par tâche.
 */

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'anthropic', label: 'Claude' },
  { id: 'openai', label: 'ChatGPT' },
  { id: 'gemini', label: 'Gemini' },
];

const ASSISTANT_OPTIONS: { value: PreferredProvider; label: string }[] = [
  { value: 'auto', label: 'Automatique' },
  ...PROVIDERS.map((provider) => ({ value: provider.id as PreferredProvider, label: provider.label })),
];

interface ProviderState {
  tone: 'ok' | 'warn' | 'off';
  label: string;
}

/** L'état RÉEL de chaque fournisseur — jamais une supposition optimiste. */
function providerState(id: ProviderId): ProviderState {
  if (id === 'anthropic') {
    return hasApiKey()
      ? { tone: 'ok', label: 'Configuré' }
      : { tone: 'off', label: 'Clé manquante' };
  }
  const status = proxyProviderStatus(id as ProxyProviderId);
  if (status === 'configured') return { tone: 'ok', label: 'Configuré' };
  if (status === 'not-configured') return { tone: 'warn', label: 'Clé serveur absente' };
  if (status === 'unreachable') return { tone: 'off', label: 'Indisponible ici' };
  return { tone: 'warn', label: 'Non vérifié' };
}

const TONE_COLORS: Record<ProviderState['tone'], string> = {
  ok: 'var(--success)',
  warn: 'var(--warning)',
  off: 'var(--ink-faint)',
};

export function AiSettingsCard() {
  const confirm = useConfirm();

  const [assistant, setAssistant] = useState<PreferredProvider>(getPreferredProvider);
  const [statusVersion, setStatusVersion] = useState(0);
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [results, setResults] = useState<Partial<Record<ProviderId, ProviderTestResult>>>({});
  const [showDetail, setShowDetail] = useState<Partial<Record<ProviderId, boolean>>>({});

  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [workspaceDraft, setWorkspaceDraft] = useState('');
  const [taskPreferences, setTaskPreferences] = useState<Partial<Record<AITask, ProviderId>>>(getAllTaskProviderPreferences);
  const [usage, setUsage] = useState<AiUsageDay | null>(null);
  const [cacheCount, setCacheCount] = useState<number | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  const refreshUsage = () => {
    void getTodayUsage().then(setUsage);
    void countCacheEntries().then(setCacheCount);
  };

  useEffect(() => {
    refreshUsage();
  }, []);

  // Le modèle affiché suit l'assistant choisi ; en « Automatique », on règle
  // celui de Claude, seul fournisseur dont la clé vit sur cet appareil.
  const modelProvider: ProviderId = assistant === 'auto' ? 'anthropic' : assistant;
  const [model, setModel] = useState(() => getModelFor(modelProvider));
  const modelStatus = modelStatusFor(modelProvider);

  useEffect(() => {
    setModel(getModelFor(modelProvider));
  }, [modelProvider]);

  useEffect(() => {
    setStoredKey(getApiKey());
    setWorkspaceDraft(getWorkspaceId() ?? '');
  }, []);

  // Un seul rafraîchissement au montage : jamais de test automatique des
  // fournisseurs, qui consommerait du quota sans que personne l'ait demandé.
  useEffect(() => {
    void refreshProviderStatus().then(() => setStatusVersion((v) => v + 1));
  }, []);

  void statusVersion; // dépendance de rendu volontaire — le cache n'est pas réactif.

  const checkConfiguration = async () => {
    setChecking(true);
    try {
      await refreshProviderStatus();
      setStatusVersion((v) => v + 1);
    } finally {
      setChecking(false);
    }
  };

  /** Teste UNIQUEMENT le fournisseur demandé — jamais les deux autres. */
  const testOne = async (id: ProviderId) => {
    setTesting(id);
    try {
      const result = await aiOrchestrator.testProvider(id);
      setResults((current) => ({ ...current, [id]: result }));
      refreshUsage();
    } finally {
      setTesting(null);
    }
  };

  const emptyCache = async () => {
    setClearingCache(true);
    try {
      await clearAiCache();
      refreshUsage();
    } finally {
      setClearingCache(false);
    }
  };

  const saveKey = () => {
    const trimmed = keyDraft.trim();
    if (trimmed.length === 0) return;
    setApiKey(trimmed);
    setStoredKey(trimmed);
    setKeyDraft('');
  };

  const removeKey = async () => {
    const ok = await confirm({
      title: 'Supprimer la clé Claude ?',
      description: 'Claude sera désactivé jusqu’à ce que tu en saisisses une nouvelle.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!ok) return;
    setApiKey(null);
    setStoredKey(null);
  };

  const overridingTasks = CONFIGURABLE_TASKS.flatMap(({ task, label }) => {
    const providerId = taskPreferences[task];
    return providerId ? [{ task, label, providerId }] : [];
  });

  return (
    <Card>
      <CardTitle>IA</CardTitle>
      <CardSubtitle>Quel assistant répond, avec quel modèle — et s’il fonctionne vraiment.</CardSubtitle>

      <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
        <Select
          label="Assistant préféré"
          value={assistant}
          hint={assistant === 'auto' ? 'Le premier fournisseur disponible répond.' : 'Seul ce fournisseur est utilisé.'}
          onChange={(event) => {
            const value = event.target.value as PreferredProvider;
            setAssistant(value);
            setPreferredProvider(value);
          }}
          data-hub-preferred-provider
        >
          {ASSISTANT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          label={`Modèle ${PROVIDERS.find((entry) => entry.id === modelProvider)?.label ?? ''}`}
          value={model}
          hint={PROVIDER_MODELS[modelProvider].find((entry) => entry.id === model)?.hint}
          onChange={(event) => {
            setModel(event.target.value);
            setModelFor(modelProvider, event.target.value);
          }}
          data-ai-model
        >
          {PROVIDER_MODELS[modelProvider].map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select>
      </div>

      {modelStatus.unavailable && (
        <p
          className="mt-2 rounded-[var(--radius-control)] border border-[var(--warning)] bg-[var(--warning-tint)] px-3.5 py-2.5 text-[0.8rem] leading-relaxed"
          data-ai-model-unavailable
        >
          Le modèle « {modelStatus.unavailable} » n’est plus disponible. {modelStatus.effective} est utilisé à la place —
          choisis-en un ci-dessus pour figer ce choix.
        </p>
      )}

      {/* ────────────── Fournisseurs ────────────── */}
      <div className="mt-5 border-t border-[var(--line)] pt-4">
        <p className="mb-2.5 text-[0.85rem] font-medium">Fournisseurs</p>
        <ul className="flex flex-col gap-2">
          {PROVIDERS.map(({ id, label }) => {
            const state = providerState(id);
            const result = results[id];
            return (
              <li key={id} className="rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[0.88rem] font-medium">{label}</span>
                  <span className="flex items-center gap-2.5">
                    <span className="text-[0.78rem] font-medium" style={{ color: TONE_COLORS[state.tone] }}>
                      {state.label}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={testing === id}
                      disabled={testing !== null && testing !== id}
                      onClick={() => void testOne(id)}
                      data-hub-test-provider={id}
                    >
                      Tester
                    </Button>
                  </span>
                </div>

                {result && (
                  <div className="mt-2 text-[0.8rem] leading-relaxed" data-hub-test-result={id}>
                    <p style={{ color: result.ok ? 'var(--success)' : 'var(--danger)' }}>
                      {result.ok ? 'Connexion réussie' : 'Connexion impossible'}
                    </p>
                    {!result.ok && <p className="mt-0.5 text-[var(--ink-soft)]">{result.message}</p>}
                    {result.detail && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowDetail((current) => ({ ...current, [id]: !current[id] }))}
                          className="mt-1 text-[0.76rem] text-[var(--ink-faint)] underline underline-offset-2"
                        >
                          Détails techniques
                        </button>
                        {showDetail[id] && (
                          <p className="mt-1 font-mono text-[0.72rem] break-words text-[var(--ink-faint)]">
                            {result.detail}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2.5 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
          « Tester » envoie une vraie question au fournisseur choisi, et à lui seul.
        </p>
        {usage && (
          <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]" data-ai-usage-today>
            IA aujourd’hui : {usage.apiCalls} appel{usage.apiCalls === 1 ? '' : 's'} API
            {usage.cacheHits > 0 && <> · {usage.cacheHits} depuis le cache (sans appel réseau)</>}
            {usage.errors > 0 && <> · {usage.errors} échec{usage.errors === 1 ? '' : 's'}</>}
          </p>
        )}
      </div>

      {/* ────────────── Avancé ────────────── */}
      <details className="mt-5 border-t border-[var(--line)] pt-4" data-ai-advanced>
        <summary className="cursor-pointer text-[0.85rem] font-medium">Avancé</summary>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <p className="mb-2 text-[0.83rem] font-medium">Clé Claude</p>
            <p className="mb-2.5 text-[0.78rem] leading-relaxed text-[var(--ink-soft)]">
              Enregistrée <strong>uniquement sur cet appareil</strong>, jamais incluse dans tes sauvegardes. ChatGPT et
              Gemini n’ont rien à saisir ici : leurs clés vivent côté serveur.
            </p>
            {storedKey ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--line)] px-3.5 py-2.5">
                <span className="font-mono text-[0.8rem] text-[var(--ink-soft)]">{maskApiKey(storedKey)}</span>
                <Button size="sm" variant="danger" onClick={() => void removeKey()}>
                  Supprimer
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-ant-…"
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  data-anthropic-key
                />
                <Button size="sm" onClick={saveKey}>
                  Enregistrer la clé
                </Button>
              </div>
            )}
          </div>

          <Input
            label="Workspace ID Claude (facultatif)"
            autoComplete="off"
            spellCheck={false}
            placeholder="wrkspc_…"
            value={workspaceDraft}
            hint="Nécessaire seulement si Claude répond que ta clé est liée à une identité."
            onChange={(event) => {
              setWorkspaceDraft(event.target.value);
              setWorkspaceId(event.target.value);
            }}
            data-anthropic-workspace-id
          />

          <div>
            <p className="mb-1.5 text-[0.83rem] font-medium">Fournisseur par fonctionnalité</p>
            <p className="mb-2.5 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
              Par défaut, tout suit l’assistant préféré. Un réglage ici l’emporte pour cette fonctionnalité seulement.
            </p>
            {overridingTasks.length > 0 && (
              <p className="mb-2.5 rounded-[var(--radius-control)] border border-[var(--warning)] bg-[var(--warning-tint)] px-3 py-2 text-[0.78rem]" data-hub-task-overrides>
                {overridingTasks.map(({ label, providerId }) => `${label} → ${PROVIDERS.find((p) => p.id === providerId)?.label}`).join(', ')}
              </p>
            )}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {CONFIGURABLE_TASKS.map(({ task, label }) => (
                <Select
                  key={task}
                  label={label}
                  value={taskPreferences[task] ?? 'auto'}
                  onChange={(event) => {
                    setTaskProviderPreference(task, event.target.value as TaskProviderPreference);
                    setTaskPreferences(getAllTaskProviderPreferences());
                  }}
                  data-hub-task-preference={task}
                >
                  {ASSISTANT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ))}
            </div>
            {overridingTasks.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2.5"
                onClick={() => {
                  for (const { task } of overridingTasks) setTaskProviderPreference(task, 'auto');
                  setTaskPreferences(getAllTaskProviderPreferences());
                }}
                data-hub-reset-task-preferences
              >
                Tout remettre sur « Automatique »
              </Button>
            )}
          </div>

          <div>
            <Button size="sm" variant="secondary" loading={checking} onClick={() => void checkConfiguration()} data-hub-check-status>
              Vérifier la configuration
            </Button>
            <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
              Relit seulement quelles clés sont en place côté serveur, sans rien envoyer aux fournisseurs.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[0.83rem] font-medium">Cache des réponses</p>
            <p className="mb-2.5 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
              Une question identique (même fonctionnalité, même assistant, même modèle, même texte) répond depuis ce
              cache local — sans appel réseau, sans consommer de quota. {cacheCount ?? 0} réponse
              {cacheCount === 1 ? '' : 's'} actuellement en cache.
            </p>
            <Button
              size="sm"
              variant="secondary"
              loading={clearingCache}
              disabled={!cacheCount}
              onClick={() => void emptyCache()}
              data-ai-clear-cache
            >
              Vider le cache
            </Button>
          </div>

          <div className="rounded-[var(--radius-control)] bg-[var(--surface-2)]/60 px-3.5 py-3 text-[0.78rem] leading-relaxed text-[var(--ink-soft)]">
            <p>
              <strong>ChatGPT et Gemini</strong> n’autorisent pas l’appel direct depuis un navigateur : Musab Study les
              relaie par de petites fonctions serveur, dont les clés vivent dans les variables d’environnement du
              déploiement. Sans ce relais, ils restent indisponibles et Claude fonctionne seul.
            </p>
            <p className="mt-2">
              <strong>Recherche web</strong> : seul Claude la pratique réellement aujourd’hui. Le mode Internet le
              signale plutôt que de faire croire à une recherche qui n’a pas eu lieu.
            </p>
            <p className="mt-2">
              <strong>Gemini Education</strong> est une offre de licence, pas une API distincte — le fournisseur
              Gemini ci-dessus la couvre.
            </p>
            <p className="mt-2">
              <strong>Abonnement ChatGPT (Plus/Pro) et API OpenAI sont deux facturations séparées.</strong> Payer
              ChatGPT ne crédite pas l’API : il faut un moyen de paiement distinct sur platform.openai.com → Billing
              pour que ce relais fonctionne.
            </p>
          </div>
        </div>
      </details>
    </Card>
  );
}
