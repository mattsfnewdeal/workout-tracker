import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_TARGET_RPE, MAX_EFFECTIVE_REPS } from '../../engine';
import { createProgram, emptyProgram, findOrCreateExercise, newDay, newId, newSlot, saveProgram, updateExercise } from '../../db/ops';
import { getActiveProgram, getAllExercises, getArchivedPrograms, getInProgressSession } from '../../db/queries';
import { useLiveQuery } from '../../db/useLiveQuery';
import type { Day, Exercise, Program, Slot } from '../../model/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NumberField } from '../components/NumberField';
import { RpePicker } from '../components/RpePicker';
import { fmtDate, fmtLoad } from '../format';

function cloneProgram(p: Program): Program {
  return {
    ...p,
    id: newId(),
    name: `${p.name} (copy)`,
    nextDayIndex: 0,
    status: 'active',
    createdAt: Date.now(),
    archivedAt: undefined,
    days: p.days.map((d) => ({ ...d, id: newId(), slots: d.slots.map((s) => ({ ...s, id: newId() })) })),
  };
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
  const [copy, setCopy] = useState(false);

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

  async function startNew() {
    try {
      const p = copy && active ? cloneProgram(active) : emptyProgram(active ? `Program ${archived.length + 2}` : 'My program');
      await createProgram(p);
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
          <p>No program yet. Build your weekly cycle: days, then exercises with sets, reps and an RPE goal.</p>
          <button type="button" class="btn btn-primary btn-big" onClick={startNew}>Create a program</button>
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
          {inProgress && <p class="muted small">A session is in progress; edits apply to the next session.</p>}

          {draft.days.map((day, di) => (
            <DayEditor
              key={day.id}
              day={day}
              index={di}
              count={draft.days.length}
              exercises={exercises}
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
                          return <li key={s.id}>{ex?.name ?? 'Unknown'} — {s.sets} × {s.progression === 'single' ? s.targetReps : `${s.repMin}–${s.repMax}`} @ {s.targetRpe}</li>;
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
        onConfirm={startNew}
      >
        {active && (
          <>
            <p>The current program is kept read-only under Archived. Exercise history and progression carry over.</p>
            <label class="row gap">
              <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.currentTarget.checked)} /> Start from a copy of it
            </label>
          </>
        )}
      </ConfirmDialog>
    </main>
  );
}

interface DayProps {
  day: Day;
  index: number;
  count: number;
  exercises: Exercise[];
  onChange: (d: Day) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}

function DayEditor({ day, index, count, exercises, onChange, onMove, onDelete }: DayProps) {
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState<string | null>(null);

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

      {day.slots.map((slot, si) => (
        <SlotEditor
          key={slot.id}
          slot={slot}
          exercise={exercises.find((e) => e.id === slot.exerciseId)}
          index={si}
          count={day.slots.length}
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
        <button type="button" class="btn" onClick={addExercise}>Add</button>
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
  onChange: (s: Slot) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}

function SlotEditor({ slot, exercise, index, count, onChange, onMove, onDelete }: SlotProps) {
  const keyReps = slot.progression === 'single' ? slot.targetReps : slot.repMin;
  const offChart = keyReps != null && keyReps + (10 - slot.targetRpe) > MAX_EFFECTIVE_REPS;

  return (
    <div class="card" style="margin-top:10px; background: var(--bg)">
      <div class="row gap">
        <strong class="grow">{exercise?.name ?? 'Unknown exercise'}</strong>
        <button type="button" class="btn btn-small btn-icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">↑</button>
        <button type="button" class="btn btn-small btn-icon" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">↓</button>
        <button type="button" class="btn btn-small btn-icon" onClick={onDelete} aria-label="Remove">✕</button>
      </div>
      <div class="row gap" style="margin-top:8px">
        <label class="field grow">
          Sets
          <NumberField value={slot.sets} onChange={(v) => onChange({ ...slot, sets: v ?? 1 })} mode="numeric" min={1} />
        </label>
        <label class="field grow">
          Reps
          <select value={slot.progression} onChange={(e) => {
            const progression = e.currentTarget.value as Slot['progression'];
            onChange(progression === 'single'
              ? { ...slot, progression, targetReps: slot.targetReps ?? slot.repMin ?? 5 }
              : { ...slot, progression, repMin: slot.repMin ?? slot.targetReps ?? 6, repMax: slot.repMax ?? (slot.targetReps ?? 6) + 2 });
          }}>
            <option value="single">Fixed</option>
            <option value="double">Range</option>
          </select>
        </label>
        {slot.progression === 'single' ? (
          <label class="field grow">
            Target
            <NumberField value={slot.targetReps} onChange={(v) => onChange({ ...slot, targetReps: v })} mode="numeric" min={1} />
          </label>
        ) : (
          <>
            <label class="field grow">
              Min
              <NumberField value={slot.repMin} onChange={(v) => onChange({ ...slot, repMin: v })} mode="numeric" min={1} />
            </label>
            <label class="field grow">
              Max
              <NumberField value={slot.repMax} onChange={(v) => onChange({ ...slot, repMax: v })} mode="numeric" min={1} />
            </label>
          </>
        )}
      </div>
      <label class="field" style="margin-top:8px">
        RPE goal
        <RpePicker compact value={slot.targetRpe} onChange={(v) => onChange({ ...slot, targetRpe: v ?? DEFAULT_TARGET_RPE })} label="RPE goal" />
      </label>
      <div class="row gap" style="margin-top:8px">
        <label class="field grow">
          Starting load (lb)
          <NumberField value={slot.startingLoad} onChange={(v) => onChange({ ...slot, startingLoad: v ?? 0 })} mode="decimal" min={0} />
        </label>
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
      </div>
      <p class="muted small" style="margin:6px 0 0">
        Increment is per exercise{exercise ? ` (${exercise.name}, currently ${fmtLoad(exercise.loadIncrement)} lb)` : ''} and saves immediately.
      </p>
      {offChart && (
        <p class="small" style="color: var(--warn); margin:6px 0 0">
          Rep target is past the RPE chart; suggestions will step by one increment (low confidence).
        </p>
      )}
    </div>
  );
}
