import { useEffect, useState } from 'preact/hooks';
import { MAX_EFFECTIVE_REPS } from '../../engine';
import { createProgram, emptyProgram, findOrCreateExercise, newDay, newId, newSlot, newWarmup, saveProgram, updateExercise } from '../../db/ops';
import { TEMPLATES, loadTemplate } from '../../db/templates';
import { getActiveProgram, getAllExercises, getArchivedPrograms, getInProgressSession } from '../../db/queries';
import { useLiveQuery } from '../../db/useLiveQuery';
import type { Day, Exercise, Program, Slot, WarmupItem } from '../../model/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NumberField } from '../components/NumberField';
import { SlotFields } from '../components/SlotFields';
import { fmtDate, fmtLoad } from '../format';
import { introEndsAt } from '../../state/plan';

type NewSource = 'empty' | 'copy' | `template:${number}`;
const SOURCES: [NewSource, string][] = [
  ...TEMPLATES.map((t, i): [NewSource, string] => [`template:${i}`, `Preloaded: ${t.name} — ${t.blurb}`]),
  ['empty', 'Empty program'],
  ['copy', 'Copy of the current program'],
];

function cloneProgram(p: Program): Program {
  return {
    ...p,
    id: newId(),
    name: `${p.name} (copy)`,
    nextDayIndex: 0,
    status: 'active',
    createdAt: Date.now(),
    archivedAt: undefined,
    introStartsAt: undefined,
    days: p.days.map((d) => ({ ...d, id: newId(), warmups: (d.warmups ?? []).map((w) => ({ ...w, id: newId() })), slots: d.slots.map((s) => ({ ...s, id: newId() })) })),
  };
}

/** Local calendar date for a date input, and back to local midnight. */
function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromDateInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function ProgramEditor() {
  const active = useLiveQuery(() => getActiveProgram(), []);
  const exercises = useLiveQuery(() => getAllExercises(), []) ?? [];
  const inProgress = useLiveQuery(() => getInProgressSession(), []);
  const archived = useLiveQuery(() => getArchivedPrograms(), []) ?? [];

  const [draft, setDraft] = useState<Program | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [source, setSource] = useState<NewSource>('template:0');

  useEffect(() => {
    if (active === undefined) return;
    if (!active) {
      setDraft(null);
      setDirty(false);
      return;
    }
    if (!dirty || !draft || draft.id !== active.id) {
      setDraft(active);
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function edit(fn: (p: Program) => Program) {
    setDraft((p) => (p ? fn(p) : p));
    setDirty(true);
    setMessage(null);
  }

  async function save() {
    if (!draft) return;
    try {
      await saveProgram(draft);
      setDirty(false);
      setMessage({ kind: 'ok', text: 'Saved' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  }

  async function startNew(src: NewSource) {
    try {
      let p: Program;
      if (src.startsWith('template:')) {
        p = await loadTemplate(TEMPLATES[Number(src.slice('template:'.length))]);
      } else {
        p = src === 'copy' && active ? cloneProgram(active) : emptyProgram(active ? `Program ${archived.length + 2}` : 'My program');
        await createProgram(p);
      }
      setDraft(p);
      setDirty(false);
      setMessage({ kind: 'ok', text: active ? `Archived “${active.name}”` : 'Program created' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setConfirmNew(false);
    }
  }

  if (active === undefined) return <main class="screen" />;

  return (
    <main class="screen">
      <div class="row between">
        <h1>Program</h1>
        {draft && (
          <button type="button" class="btn btn-small" disabled={!!inProgress} onClick={() => setConfirmNew(true)} title={inProgress ? 'Finish or abandon the current session first' : ''}>
            New program
          </button>
        )}
      </div>

      {!draft ? (
        <div class="empty">
          <p>No program yet. Use a preloaded program, or build your own: days, then exercises with sets, reps and a progression rule. You’ll pick each weight in your first session.</p>
          {TEMPLATES.map((t, i) => (
            <button type="button" key={t.name} class={`btn ${i === 0 ? 'btn-primary btn-big' : ''}`} onClick={() => startNew(`template:${i}`)}>Use preloaded: {t.name}</button>
          ))}
          <button type="button" class="btn" onClick={() => startNew('empty')}>Build from scratch</button>
        </div>
      ) : (
        <>
          <label class="field">
            Name
            <input class="text" type="text" value={draft.name} onInput={(e) => edit((p) => ({ ...p, name: e.currentTarget.value }))} />
          </label>
          <label class="field" style="margin-top:8px">
            Next session
            <select value={draft.nextDayIndex} onChange={(e) => edit((p) => ({ ...p, nextDayIndex: Number(e.currentTarget.value) }))}>
              {draft.days.map((d, i) => <option key={d.id} value={i}>{d.name}</option>)}
            </select>
          </label>
          <label class="field" style="margin-top:8px">
            Intro weeks
            <NumberField
              value={draft.introWeeks}
              onChange={(v) => edit((p) => { const next = { ...p }; if (v == null || v === 0) delete next.introWeeks; else next.introWeeks = v; return next; })}
              mode="numeric"
              min={0}
              placeholder="0"
            />
          </label>
          {!!draft.introWeeks && (
            <label class="field" style="margin-top:8px">
              Intro starts
              <input
                class="text"
                type="date"
                value={toDateInput(draft.introStartsAt ?? draft.createdAt)}
                onChange={(e) => {
                  const ts = fromDateInput(e.currentTarget.value);
                  edit((p) => { const next = { ...p }; if (ts == null) delete next.introStartsAt; else next.introStartsAt = ts; return next; });
                }}
              />
            </label>
          )}
          <p class="muted small" style="margin:4px 0 0">
            Exercises with an intro set count run that many sets until the intro weeks end
            {draft.introWeeks ? ` (${fmtDate(introEndsAt(draft) ?? undefined)}). Sessions before the start date count as week 0 and use the intro counts too.` : '.'}
          </p>
          {inProgress && <p class="muted small">A session is in progress; edits apply to the next session.</p>}

          {draft.days.map((day, di) => (
            <DayEditor
              key={day.id}
              day={day}
              index={di}
              count={draft.days.length}
              exercises={exercises}
              showIntro={!!draft.introWeeks}
              onChange={(d) => edit((p) => ({ ...p, days: p.days.map((x) => (x.id === d.id ? d : x)) }))}
              onMove={(dir) => edit((p) => ({ ...p, days: move(p.days, di, di + dir) }))}
              onDelete={() => edit((p) => ({ ...p, days: p.days.filter((x) => x.id !== day.id) }))}
            />
          ))}
          <button type="button" class="btn" style="margin-top:12px" onClick={() => edit((p) => ({ ...p, days: [...p.days, newDay(`Day ${String.fromCharCode(65 + p.days.length)}`)] }))}>
            + Add day
          </button>

          {message && <p class={message.kind === 'ok' ? 'ok' : 'error'}>{message.text}</p>}
          <div class="row gap sticky-bottom">
            {dirty && (
              <button type="button" class="btn" onClick={() => { setDraft(active ?? null); setDirty(false); setMessage(null); }}>Discard</button>
            )}
            <button type="button" class="btn btn-primary grow" disabled={!dirty} onClick={save}>{dirty ? 'Save changes' : 'Saved'}</button>
          </div>
        </>
      )}

      {archived.length > 0 && (
        <>
          <hr />
          <h2>Archived programs</h2>
          <ul class="list">
            {archived.map((p) => (
              <li key={p.id} class="card">
                <details class="archived">
                  <summary>
                    <strong>{p.name}</strong>
                    <span class="muted small"> · {fmtDate(p.createdAt)} – {fmtDate(p.archivedAt)}</span>
                  </summary>
                  {p.days.map((d) => (
                    <div key={d.id} class="small" style="margin-top:6px">
                      <strong>{d.name}</strong>
                      <ul style="margin:2px 0 0; padding-left:18px">
                        {d.slots.map((s) => {
                          const ex = exercises.find((e) => e.id === s.exerciseId);
                          return <li key={s.id}>{ex?.name ?? 'Unknown'} — {s.sets} × {s.progression === 'single' ? s.targetReps : `${s.repMin}–${s.repMax}`}{s.targetRpe != null ? ` @ ${s.targetRpe}` : ''}{s.rule === 'linear' ? ' · linear' : ''}</li>;
                        })}
                      </ul>
                    </div>
                  ))}
                </details>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={confirmNew}
        title={active ? `Archive “${active.name}”?` : 'Create a program?'}
        confirmLabel="New program"
        onCancel={() => setConfirmNew(false)}
        onConfirm={() => startNew(source)}
      >
        {active && <p>The current program is kept read-only under Archived. Exercise history and progression carry over.</p>}
        <div class="stack" style="margin-top:8px">
          {SOURCES.filter(([v]) => v !== 'copy' || active).map(([v, label]) => (
            <label key={v} class="check">
              <input type="radio" name="new-program-source" value={v} checked={source === v} onChange={() => setSource(v)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </ConfirmDialog>
    </main>
  );
}

interface DayProps {
  day: Day;
  index: number;
  count: number;
  exercises: Exercise[];
  showIntro: boolean;
  onChange: (d: Day) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}

function DayEditor({ day, index, count, exercises, showIntro, onChange, onMove, onDelete }: DayProps) {
  const [newName, setNewName] = useState('');
  const [newWarmupName, setNewWarmupName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const warmups = day.warmups ?? [];

  const setWarmup = (w: WarmupItem) => onChange({ ...day, warmups: warmups.map((x) => (x.id === w.id ? w : x)) });
  function addWarmup() {
    const name = newWarmupName.trim();
    if (!name) return;
    onChange({ ...day, warmups: [...warmups, newWarmup(name)] });
    setNewWarmupName('');
  }

  async function addExercise() {
    const name = newName.trim();
    if (!name) return;
    try {
      const ex = await findOrCreateExercise(name);
      if (day.slots.some((s) => s.exerciseId === ex.id)) {
        setErr(`${ex.name} is already on ${day.name}`);
        return;
      }
      onChange({ ...day, slots: [...day.slots, newSlot(ex.id)] });
      setNewName('');
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <section class="card" style="margin-top:12px">
      <div class="row gap">
        <input class="text grow" type="text" value={day.name} aria-label="Day name" onInput={(e) => onChange({ ...day, name: e.currentTarget.value })} />
        <button type="button" class="btn btn-small btn-icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move day up">↑</button>
        <button type="button" class="btn btn-small btn-icon" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move day down">↓</button>
        <button type="button" class="btn btn-small btn-icon" onClick={onDelete} aria-label="Delete day">✕</button>
      </div>

      <p class="muted small" style="margin:10px 0 2px">Warm-up · checkbox only</p>
      {warmups.map((w) => (
        <div key={w.id} class="row gap" style="margin-top:6px">
          <input class="text grow" type="text" value={w.name} aria-label="Warm-up name" onInput={(e) => setWarmup({ ...w, name: e.currentTarget.value })} />
          <input
            class="text grow"
            type="text"
            value={w.note ?? ''}
            placeholder="note, e.g. 3 × 5"
            aria-label="Warm-up note"
            onInput={(e) => {
              const next: WarmupItem = { ...w, note: e.currentTarget.value };
              if (!next.note) delete next.note;
              setWarmup(next);
            }}
          />
          <button type="button" class="btn btn-small btn-icon" onClick={() => onChange({ ...day, warmups: warmups.filter((x) => x.id !== w.id) })} aria-label="Remove warm-up">✕</button>
        </div>
      ))}
      <div class="row gap" style="margin-top:6px">
        <input
          class="text grow"
          type="text"
          placeholder="Warm-up name"
          value={newWarmupName}
          onInput={(e) => setNewWarmupName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addWarmup(); } }}
        />
        <button type="button" class="btn" aria-label="Add warm-up" onClick={addWarmup}>Add</button>
      </div>

      <p class="muted small" style="margin:14px 0 2px">Exercises</p>
      {day.slots.map((slot, si) => (
        <SlotEditor
          key={slot.id}
          slot={slot}
          exercise={exercises.find((e) => e.id === slot.exerciseId)}
          index={si}
          count={day.slots.length}
          showIntro={showIntro}
          onChange={(s) => onChange({ ...day, slots: day.slots.map((x) => (x.id === s.id ? s : x)) })}
          onMove={(dir) => onChange({ ...day, slots: move(day.slots, si, si + dir) })}
          onDelete={() => onChange({ ...day, slots: day.slots.filter((x) => x.id !== slot.id) })}
        />
      ))}

      <div class="row gap" style="margin-top:10px">
        <input
          class="text grow"
          type="text"
          list={`ex-${day.id}`}
          placeholder="Exercise name"
          value={newName}
          onInput={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addExercise(); } }}
        />
        <datalist id={`ex-${day.id}`}>
          {exercises.map((e) => <option key={e.id} value={e.name} />)}
        </datalist>
        <button type="button" class="btn" aria-label="Add exercise" onClick={addExercise}>Add</button>
      </div>
      {err && <p class="error small">{err}</p>}
    </section>
  );
}

interface SlotProps {
  slot: Slot;
  exercise: Exercise | undefined;
  index: number;
  count: number;
  showIntro: boolean;
  onChange: (s: Slot) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}

function SlotEditor({ slot, exercise, index, count, showIntro, onChange, onMove, onDelete }: SlotProps) {
  const keyReps = slot.progression === 'single' ? slot.targetReps : slot.repMin;
  const offChart = slot.rule !== 'linear' && keyReps != null && keyReps + (10 - (slot.targetRpe ?? 8)) > MAX_EFFECTIVE_REPS;

  return (
    <div class="card" style="margin-top:10px; background: var(--bg)">
      <div class="row gap">
        <strong class="grow">{exercise?.name ?? 'Unknown exercise'}</strong>
        <button type="button" class="btn btn-small btn-icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
        <button type="button" class="btn btn-small btn-icon" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">↓</button>
        <button type="button" class="btn btn-small btn-icon" onClick={onDelete} aria-label="Remove">✕</button>
      </div>
      {index > 0 && (
        <label class="check" style="min-height:36px; margin-top:8px">
          <input
            type="checkbox"
            checked={!!slot.supersetWithPrev}
            aria-label={`${exercise?.name ?? 'Exercise'} superset with the exercise above`}
            onChange={(e) => { const next = { ...slot }; if (e.currentTarget.checked) next.supersetWithPrev = true; else delete next.supersetWithPrev; onChange(next); }}
          />
          <span class="small">Superset with the exercise above (A1 / A2)</span>
        </label>
      )}
      <SlotFields slot={slot} onChange={onChange} showIntro={showIntro} />
      <div class="row gap" style="margin-top:8px">
        <label class="field grow">
          Increment (lb)
          <NumberField
            value={exercise?.loadIncrement}
            onChange={(v) => { if (exercise && v && v > 0) void updateExercise(exercise.id, { loadIncrement: v }); }}
            mode="decimal"
            min={0}
            disabled={!exercise}
          />
        </label>
        <label class="check grow" style="min-height:48px; align-self:flex-end">
          <input type="checkbox" checked={!!exercise?.bodyweight} disabled={!exercise} aria-label={`${exercise?.name ?? 'Exercise'} is bodyweight`} onChange={(e) => { if (exercise) void updateExercise(exercise.id, { bodyweight: e.currentTarget.checked }); }} />
          <span class="small">Bodyweight</span>
        </label>
      </div>
      <p class="muted small" style="margin:6px 0 0">
        Increment and Bodyweight are per exercise{exercise ? ` (${exercise.name}, currently ${fmtLoad(exercise.loadIncrement)} lb${exercise.bodyweight ? ', bodyweight' : ''})` : ''} and save immediately. Bodyweight: the load is added weight; leave it empty for none.
      </p>
      {offChart && (
        <p class="small" style="color: var(--warn); margin:6px 0 0">
          Rep target is past the RPE chart; suggestions will step by one increment (low confidence).
        </p>
      )}
    </div>
  );
}
