import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { Stagger, StaggerItem } from '@/components/motion/Motion';
import { CountUp } from '@/components/motion/Reveal';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  Input,
  Modal,
  Swatch,
  useConfirm,
  useToast,
} from '@/components/ui';
import { useSubjectOverviews, useSubjects } from '@/hooks/useSubjects';
import { createSubject, deleteSubject, SUBJECT_COLORS } from '@/data/repositories/subjects';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';

/**
 * Compteurs d'une matière, écrits comme on les dirait.
 *
 * La version précédente affichait quatre lignes systématiquement, y compris
 * « 0 carte(s) 0 note(s) » : trois quarts de l'information étaient donc du
 * bruit sur une matière qu'on vient de créer, et le « (s) » entre parenthèses
 * donnait au tout un air de sortie de base de données. Un compteur à zéro
 * n'apprend rien — sauf le premier, celui des chapitres, dont l'absence est
 * justement l'information utile (« cette matière est vide »).
 */
function summarize(stats: { chapters: number; documents: number; cards: number; notes: number }): string[] {
  if (stats.chapters === 0) return ['Aucun chapitre pour l’instant'];

  const lines = [plural(stats.chapters, 'chapitre')];
  if (stats.documents > 0) lines.push(plural(stats.documents, 'document'));
  if (stats.cards > 0) lines.push(plural(stats.cards, 'carte'));
  if (stats.notes > 0) lines.push(plural(stats.notes, 'note'));
  return lines;
}

/** Liste des matières, avec leurs compteurs réels. */
export function CoursesPage() {
  const subjects = useSubjects();
  const overviews = useSubjectOverviews();
  const { notify } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(SUBJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const runSearch = () => {
    const query = search.trim();
    if (query.length === 0) return;
    navigate(`/recherche?q=${encodeURIComponent(query)}`);
  };

  /**
   * Supprime une matière depuis la LISTE. La confirmation rappelle ce qui part
   * avec elle : une matière emporte ses chapitres, ses documents, ses
   * flashcards et son historique de révision — c'est irréversible, et
   * l'utilisateur doit le savoir avant de valider, pas après.
   */
  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Supprimer « ${name} » ?`,
      description:
        'Ses chapitres, ses documents, ses flashcards et leur historique de révision seront supprimés. Cette action est définitive.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!ok) return;
    await deleteSubject(id);
    notify(`Matière « ${name} » supprimée.`, 'info');
  };

  const handleCreate = async () => {
    if (name.trim().length === 0) {
      notify('Donne un nom à cette matière.', 'error');
      return;
    }
    setSaving(true);
    try {
      await createSubject(name, color);
      // « Matière » explicite : « « Cours » créée. » laissait croire à une
      // faute d'accord alors que c'est bien la matière qui est créée.
      notify(`Matière « ${name.trim()} » créée.`, 'success');
      setName('');
      setColor(SUBJECT_COLORS[(subjects?.length ?? 0) % SUBJECT_COLORS.length]!);
      setCreating(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageTransition>
      <PageHeader
        title="Cours"
        subtitle="Tes matières, leurs chapitres et les documents dont l’IA se sert."
        action={
          subjects && subjects.length > 0 ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              Nouvelle matière
            </Button>
          ) : undefined
        }
      />

      {subjects && subjects.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch();
            }}
            placeholder="Rechercher dans mes cours…"
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="md"
            onClick={runSearch}
            disabled={search.trim().length === 0}
            aria-label="Rechercher"
          >
            <Icon name="search" size={17} />
          </Button>
        </div>
      )}

      {subjects === undefined ? null : subjects.length === 0 ? (
        <EmptyState
          icon={<Icon name="courses" size={30} />}
          title="Commence par créer une matière"
          description="Une matière contient des chapitres, et chaque chapitre contient tes documents de cours. C’est à partir d’eux que l’IA, les flashcards et les quiz travailleront."
          action={<Button onClick={() => setCreating(true)}>Créer ma première matière</Button>}
        />
      ) : (
        <Stagger className="flex flex-col gap-3">
          {subjects.map((subject) => {
            const stats = overviews?.[subject.id];
            return (
              <StaggerItem key={subject.id}>
                <div className="surface-card relative">
                  {/*
                    La suppression vivait uniquement DANS la matière : il fallait
                    l'ouvrir pour pouvoir la retirer. Le bouton est posé par-dessus
                    le lien plutôt qu'à l'intérieur — un <button> imbriqué dans un
                    <a> est invalide en HTML, et le clic déclencherait les deux.
                  */}
                  <button
                    type="button"
                    aria-label={`Supprimer la matière ${subject.name}`}
                    title="Supprimer cette matière"
                    data-subject-delete={subject.id}
                    onClick={() => void handleDelete(subject.id, subject.name)}
                    className={cn(
                      'absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center',
                      'rounded-full text-[var(--ink-faint)] transition-colors',
                      'hover:bg-[var(--danger-tint)] hover:text-[var(--danger)]',
                    )}
                  >
                    <Icon name="trash" size={16} />
                  </button>

                  <Link
                    to={`/cours/${subject.id}`}
                    className="block rounded-[var(--radius-card)] p-5 pr-14 transition-colors duration-150 hover:bg-[var(--surface-hover)]"
                  >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Swatch color={subject.color} size={11} />
                      <h2 className="truncate text-[1.05rem]">{subject.name}</h2>
                    </div>
                    {stats && stats.dueCards > 0 && (
                      <Chip color="var(--accent)">
                        <CountUp value={stats.dueCards} /> à réviser
                      </Chip>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-[var(--ink-soft)]">
                    {stats ? (
                      summarize(stats).map((line) => <span key={line}>{line}</span>)
                    ) : (
                      <span>Chargement…</span>
                    )}
                  </div>
                  </Link>
                </div>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nouvelle matière"
        description="Ex. Anatomie, Histologie, Prothèse fixée…"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Annuler
            </Button>
            <Button loading={saving} onClick={handleCreate}>
              Créer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Nom"
            autoFocus
            value={name}
            placeholder="Anatomie"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
          />
          <div className="flex flex-col gap-2">
            <span className="text-[0.78rem] font-semibold text-[var(--ink-soft)]">Couleur</span>
            <div className="flex flex-wrap gap-2.5">
              {SUBJECT_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Couleur ${option}`}
                  aria-pressed={color === option}
                  onClick={() => setColor(option)}
                  className={cn(
                    'h-9 w-9 rounded-full transition-transform duration-150',
                    'ring-offset-2 ring-offset-[var(--surface)]',
                    color === option ? 'scale-110 ring-2 ring-[var(--ink)]' : 'hover:scale-105',
                  )}
                  style={{ backgroundColor: option }}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </PageTransition>
  );
}
