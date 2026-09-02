import { useEffect, useState } from 'react';
import { Button, Card, CardSubtitle, CardTitle, Select } from '@/components/ui';
import { getPreferredProvider, hasApiKey, setPreferredProvider, type PreferredProvider } from '@/services/ai/settings';
import {
  CONFIGURABLE_TASKS,
  getAllTaskProviderPreferences,
  setTaskProviderPreference,
  type TaskProviderPreference,
} from '@/services/ai/taskPreferences';
import { proxyProviderStatus, refreshProviderStatus, type ProxyProviderId } from '@/services/ai/providerStatus';
import type { AITask, ProviderId } from '@/services/ai/types';

/**
 * HUB IA — vue d'ensemble des fournisseurs, sélection (automatique ou
 * explicite), préférences par tâche. Toutes les fonctionnalités IA de
 * Musab Study passent déjà par la même couche commune
 * (`services/ai/orchestrator.ts`) — cette carte ne fait qu'exposer ce qui
 * existe déjà côté réglages, elle ne duplique aucun mécanisme.
 */

type StatusTone = 'ok' | 'warn' | 'off';

function ProviderStatusRow({ label, tone, detail }: { label: string; tone: StatusTone; detail: string }) {
  const color = tone === 'ok' ? 'var(--success)' : tone === 'warn' ? 'var(--warning)' : 'var(--ink-faint)';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3.5 py-2.5">
      <span className="text-[0.88rem] font-medium">{label}</span>
      <span className="text-[0.78rem] font-medium" style={{ color }}>
        {detail}
      </span>
    </div>
  );
}

function proxyStatusDetail(id: ProxyProviderId): { tone: StatusTone; detail: string } {
  const status = proxyProviderStatus(id);
  if (status === 'configured') return { tone: 'ok', detail: 'Configuré (relais serveur)' };
  if (status === 'not-configured') return { tone: 'warn', detail: 'Relais actif, clé serveur absente' };
  return { tone: 'off', detail: 'Relais indisponible sur ce déploiement' };
}

const PROVIDER_OPTIONS: { value: PreferredProvider; label: string }[] = [
  { value: 'auto', label: 'Automatique' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'openai', label: 'ChatGPT' },
  { value: 'gemini', label: 'Gemini' },
];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Claude',
  openai: 'ChatGPT',
  gemini: 'Gemini',
};

export function HubIaCard() {
  const [checking, setChecking] = useState(false);
  // Un simple compteur force le nouveau rendu après un rafraîchissement —
  // le cache de `providerStatus.ts` n'est pas lui-même réactif.
  const [statusVersion, setStatusVersion] = useState(0);
  const [preferredProvider, setPreferredProviderState] = useState<PreferredProvider>(getPreferredProvider);
  const [taskPreferences, setTaskPreferences] = useState<Partial<Record<AITask, ProviderId>>>(getAllTaskProviderPreferences);

  const checkStatus = async () => {
    setChecking(true);
    try {
      await refreshProviderStatus();
      setStatusVersion((v) => v + 1);
    } finally {
      setChecking(false);
    }
  };

  // Déjà lancé une fois au démarrage de l'application (App.tsx) ; relancé
  // ici pour refléter une configuration Vercel tout juste ajoutée, sans
  // attendre un rechargement complet.
  useEffect(() => {
    void checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Tâches réglées sur un fournisseur précis : ce sont elles, et elles
   * seules, qui peuvent contredire le choix général ci-dessus (voir
   * `resolveProviderChoice` dans `services/ai/orchestrator.ts` — la
   * préférence par tâche y est prioritaire).
   */
  const overridingTasks = CONFIGURABLE_TASKS.flatMap(({ task, label }) => {
    const providerId = taskPreferences[task];
    return providerId ? [{ task, label, providerId }] : [];
  });

  const resetTaskPreferences = () => {
    for (const { task } of overridingTasks) setTaskProviderPreference(task, 'auto');
    setTaskPreferences(getAllTaskProviderPreferences());
  };

  const openai = proxyStatusDetail('openai');
  const gemini = proxyStatusDetail('gemini');
  void statusVersion; // dépendance de rendu volontaire — voir setStatusVersion ci-dessus.

  return (
    <Card>
      <CardTitle>Hub IA</CardTitle>
      <CardSubtitle>
        Toutes les fonctionnalités IA de Musab Study passent par la même couche commune — choisis un fournisseur
        préféré, ou laisse « Automatique » décider.
      </CardSubtitle>

      <div className="mt-3.5 flex flex-col gap-2">
        <ProviderStatusRow
          label="Claude (Anthropic)"
          tone={hasApiKey() ? 'ok' : 'off'}
          detail={hasApiKey() ? 'Configuré (clé sur cet appareil)' : 'Non configuré'}
        />
        <ProviderStatusRow label="OpenAI (ChatGPT)" tone={openai.tone} detail={openai.detail} />
        <ProviderStatusRow label="Google Gemini" tone={gemini.tone} detail={gemini.detail} />
        <ProviderStatusRow
          label="Google NotebookLM"
          tone="off"
          detail="Pas d’API accessible pour un usage personnel"
        />
        <ProviderStatusRow label="Gemini Education" tone="off" detail="Couvert par Gemini ci-dessus" />
      </div>

      <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-2)]/60 px-3.5 py-3 text-[0.8rem] leading-relaxed text-[var(--ink-soft)]">
        <p>
          <strong>OpenAI et Gemini</strong> : ni l’un ni l’autre n’autorise un appel direct depuis un navigateur
          (CORS refusé par ces deux fournisseurs). Musab Study les relaie via de petites fonctions serveur
          (<code className="font-mono">api/ai/openai</code>, <code className="font-mono">api/ai/gemini</code>) —
          leurs clés vivent uniquement dans les variables d’environnement du déploiement, jamais sur cet appareil ni
          dans le code. Sans ce relais configuré, ces deux restent indisponibles et Claude continue de fonctionner
          seul, comme avant.
        </p>
        <p className="mt-2">
          <strong>NotebookLM</strong> n’a pas d’API en libre-service (seule une offre Entreprise existe) : chaque
          matière propose un export manuel (onglet Documents → « Exporter pour NotebookLM ») à importer toi-même sur
          notebooklm.google.com. <strong>Gemini Education</strong> est une offre de licence, pas une API distincte —
          le fournisseur Gemini ci-dessus couvre déjà ce besoin.
        </p>
      </div>

      <div className="mt-3.5">
        <Button size="sm" variant="secondary" loading={checking} onClick={() => void checkStatus()} data-hub-check-status>
          Vérifier la configuration
        </Button>
      </div>

      <div className="mt-4 border-t border-[var(--line)] pt-4">
        <Select
          label="Fournisseur préféré"
          hint="Essayé en premier pour toute tâche sans préférence propre — le repli sur un autre fournisseur disponible reste actif si celui-ci échoue."
          value={preferredProvider}
          onChange={(event) => {
            const value = event.target.value as PreferredProvider;
            setPreferredProviderState(value);
            setPreferredProvider(value);
          }}
          data-hub-preferred-provider
        >
          {PROVIDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        {/* Un réglage par tâche l'emporte sur ce choix général : sans ce
            rappel, une valeur réglée autrefois (« Gemini », par exemple)
            continuait de s'appliquer en silence après avoir choisi ChatGPT
            ici — visible seulement en dépliant la liste plus bas. */}
        {overridingTasks.length > 0 && (
          <div
            className="mt-2.5 rounded-[var(--radius-control)] border border-[var(--warning)] bg-[var(--warning-tint)] px-3.5 py-3 text-[0.8rem] leading-relaxed"
            data-hub-task-overrides
          >
            <p>
              {overridingTasks.length === 1 ? 'Une fonctionnalité ignore' : `${overridingTasks.length} fonctionnalités ignorent`} ce
              choix général, car {overridingTasks.length === 1 ? 'elle a' : 'elles ont'} un fournisseur propre :{' '}
              {overridingTasks
                .map(({ label, providerId }) => `${label} → ${PROVIDER_LABELS[providerId]}`)
                .join(', ')}
              .
            </p>
            <Button size="sm" variant="secondary" className="mt-2.5" onClick={resetTaskPreferences} data-hub-reset-task-preferences>
              Tout remettre sur « Automatique »
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-[var(--line)] pt-4">
        <p className="mb-2.5 text-[0.85rem] font-medium">Préférences par tâche</p>
        <p className="mb-3 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
          Explication → un fournisseur, résumé → un autre, etc. Aucune tâche n’a de préférence par défaut autre que
          « Automatique ».
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CONFIGURABLE_TASKS.map(({ task, label }) => (
            <Select
              key={task}
              label={label}
              value={taskPreferences[task] ?? 'auto'}
              onChange={(event) => {
                const value = event.target.value as TaskProviderPreference;
                setTaskProviderPreference(task, value);
                setTaskPreferences(getAllTaskProviderPreferences());
              }}
              data-hub-task-preference={task}
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ))}
        </div>
      </div>
    </Card>
  );
}
