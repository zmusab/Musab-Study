import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { Stagger, StaggerItem } from '@/components/motion/Motion';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  Input,
  Modal,
  Swatch,
  useToast,
} from '@/components/ui';
import { useSubjectOverviews, useSubjects } from '@/hooks/useSubjects';
import { createSubject, SUBJECT_COLORS } from '@/data/repositories/subjects';
import { cn } from '@/lib/cn';

/** Liste des matières, avec leurs compteurs réels. */
export function CoursesPage() {
  const subjects = useSubjects();
  const overviews = useSubjectOverviews();
  const { notify } = useToast();
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

  const handleCreate = async () => {
    if (name.trim().length === 0) {
      notify('Donne un nom à cette matière.', 'error');
      return;
    }
    setSaving(true);
    try {
      await createSubject(name, color);
      notify(`« ${name.trim()} » créée.`, 'success');
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
                <Link
                  to={`/cours/${subject.id}`}
                  className="surface-card block p-5 transition-colors duration-150 hover:bg-[var(--surface-hover)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Swatch color={subject.color} size={11} />
                      <h2 className="truncate text-[1.05rem]">{subject.name}</h2>
                    </div>
                    {stats && stats.dueCards > 0 && (
                      <Chip color="var(--accent)">{stats.dueCards} à réviser</Chip>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-[var(--ink-soft)]">
                    {stats ? (
                      <>
                        <span>{stats.chapters} chapitre(s)</span>
                        <span>{stats.documents} document(s)</span>
                        <span>{stats.cards} carte(s)</span>
                        <span>{stats.quizQuestions} question(s)</span>
                      </>
                    ) : (
                      <span>Chargement…</span>
                    )}
                  </div>
                </Link>
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
