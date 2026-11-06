import { Fragment } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { classifySet, reasonText } from '../../engine';
import { abandonSession, checkFinish, findOrCreateExercise, finishSession, slotProblem, type SetLogPatch } from '../../db/ops';
import type { ChangeScope, PlannedSlot, SetLog, SlotChange, SlotSpec, WarmupLog } from '../../model/types';
import { copyDownTargets } from '../../state/copyDown';
import { orderLabels, supersetGroups } from '../../state/plan';
import { useActiveSession } from '../../state/useActiveSession';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NumberField } from '../components/NumberField';
import { RpePicker } from '../components/RpePicker';
import { SlotDialog, type SlotDialogMode } from '../components/SlotDialog';
import { fmtDate, fmtLoadBw, fmtRepTarget, fmtRpe } from '../format';
import { navigate } from '../router';

function slotDone(slot: PlannedSlot, logs: SetLog[]): boolean {
  const rows = logs.filter((l) => l.slotId === slot.slotId);
  return rows.length > 0 && rows.every((l) => l.reps != null);
}

export function LogSession({ sessionId }: { sessionId: string }) {
  const { state, update, toggleWarmup, toggleWarmupSet, changeSlot, saveError } = useActiveSession(sessionId);
  const [dialog, setDialog] = useState<SlotDialogMode | null>(null);
  const [skipped, setSkipped] = useState<string[] | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (state === undefined) return <main class="screen no-tabs" />;
  if (state === null) {
    return (
      <main class="screen no-tabs">
        <p>Session not found.</p>
        <button type="button" class="btn" onClick={() => navigate('/', true)}>Back</button>
      </main>
    );
  }
  const { session, logs } = state;
  if (session.completed) {
    return (
      <main class="screen no-tabs">
        <h1>{session.dayName}</h1>
        <p class="muted">Finished {fmtDate(session.finishedAt)}.</p>
        <button type="button" class="btn" onClick={() => navigate('/', true)}>Back to Today</button>
      </main>
    );
  }

  const doneCount = session.plan.filter((s) => slotDone(s, logs)).length;

  async function doFinish() {
    setBusy(true);
    try {
      await finishSession(session.id);
      navigate('/', true);
    } catch (e) {
      setProblems((e as Error).message.split('\n'));
    } finally {
      setBusy(false);
      setSkipped(null);
    }
  }

  async function submitSlotChange(exerciseName: string, spec: SlotSpec, scope: ChangeScope, bodyweight: boolean | undefined) {
    const problem = slotProblem(spec);
    if (problem) throw new Error(problem.charAt(0).toUpperCase() + problem.slice(1)); // before creating an exercise row for a typo
    const exercise = await findOrCreateExercise(exerciseName);
    await changeSlot({ slotId: dialog?.kind === 'swap' ? dialog.slot.slotId : undefined, exerciseId: exercise.id, spec, scope, bodyweight });
    setDialog(null);
    setProblems([]);
  }

  function tryFinish() {
    const check = checkFinish(session, logs);
    if (check.problems.length) {
      setProblems(check.problems);
      return;
    }
    setProblems([]);
    if (check.skipped.length) setSkipped(check.skipped);
    else void doFinish();
  }

  return (
    <main class="screen no-tabs">
      <header class="session-head">
        <div>
          <h1>{session.dayName}</h1>
          <p class="muted">{fmtDate(session.startedAt)} · {doneCount} of {session.plan.length} exercises logged</p>
        </div>
        <button type="button" class="btn btn-small btn-ghost" onClick={() => setConfirmAbandon(true)}>Abandon</button>
      </header>

      <ul class="list">
        {session.warmups && session.warmups.length > 0 && <WarmupCard warmups={session.warmups} toggle={toggleWarmup} />}
        {supersetGroups(session.plan).map((group) => {
          const labels = orderLabels(session.plan);
          const labelOf = (slot: PlannedSlot) => labels[session.plan.indexOf(slot)];
          const rowsOf = (slot: PlannedSlot) => logs.filter((l) => l.slotId === slot.slotId);
          // Keyed on set 1's row ids, not the slot ids: a swap keeps the slot id but issues new rows, and the card must start fresh.
          const key = group.map((slot) => rowsOf(slot)[0]?.id ?? slot.slotId).join('+');
          const props = {
            update,
            onSwap: (slot: PlannedSlot) => setDialog({ kind: 'swap', slot }),
            toggleWarmupSet: (slot: PlannedSlot, i: number, done: boolean) => toggleWarmupSet(slot.slotId, i, done),
          };
          return group.length === 1
            ? <ExerciseCard key={key} slot={group[0]} label={labelOf(group[0])} logs={rowsOf(group[0])} {...props} />
            : <SupersetCard key={key} slots={group} labels={group.map(labelOf)} logsOf={rowsOf} {...props} />;
        })}
      </ul>
      <button type="button" class="btn btn-block" onClick={() => setDialog({ kind: 'add' })}>Add exercise</button>

      {saveError && <p class="error">{saveError}</p>}
      {problems.length > 0 && (
        <ul class="error problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div class="sticky-bottom">
        <button type="button" class="btn btn-primary btn-big" disabled={busy} onClick={tryFinish}>Finish</button>
      </div>

      <SlotDialog mode={dialog} dayName={session.dayName} onCancel={() => setDialog(null)} onSubmit={submitSlotChange} />
      <ConfirmDialog
        open={skipped !== null}
        title="Finish without these?"
        confirmLabel="Finish anyway"
        onCancel={() => setSkipped(null)}
        onConfirm={doFinish}
      >
        {`No sets logged for: ${(skipped ?? []).join(', ')}.\nThose exercises won’t update.`}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmAbandon}
        title="Abandon this session?"
        confirmLabel="Abandon"
        danger
        onCancel={() => setConfirmAbandon(false)}
        onConfirm={async () => {
          await abandonSession(session.id);
          navigate('/', true);
        }}
      >
        Logged sets will be deleted. The day pointer won’t move.
      </ConfirmDialog>
    </main>
  );
}

function CardHead({ title, tag, pill, pillClass, expanded, onToggle }: { title: string; tag?: string; pill: string; pillClass?: string; expanded: boolean; onToggle: () => void }) {
  return (
    <div
      class="card-head"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span class="card-title">{tag && <span class="order-tag">{tag}</span>}{title}</span>
      <span class={`pill ${pillClass ?? ''}`}>{pill}</span>
    </div>
  );
}

function WarmupCard({ warmups, toggle }: { warmups: WarmupLog[]; toggle: (id: string, done: boolean) => void }) {
  const done = warmups.filter((w) => w.done).length;
  const allDone = done === warmups.length;
  const [manual, setManual] = useState<boolean | null>(null);
  const collapsed = manual ?? allDone;
  return (
    <li class={`card ${allDone ? 'is-done' : ''}`}>
      <CardHead title="Warm-up" pill={allDone ? `${done}/${warmups.length} ✓` : `${done}/${warmups.length}`} pillClass={allDone ? 'pill-ok' : ''} expanded={!collapsed} onToggle={() => setManual(!collapsed)} />
      {!collapsed && (
        <ul class="checklist">
          {warmups.map((w) => (
            <li key={w.id}>
              <label class="check">
                <input type="checkbox" checked={w.done} onChange={(e) => toggle(w.id, e.currentTarget.checked)} />
                <span class={w.done ? 'done' : ''}>
                  {w.name}
                  {w.note && <span class="muted small"> · {w.note}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function changeText(c: SlotChange): string {
  const what = c.kind === 'swap' ? `Swapped in for ${c.replaced}` : 'Added';
  return `${what} · ${c.scope === 'session' ? 'this session only' : 'this and future sessions'}`;
}

interface CardCallbacks {
  update: (id: string, patch: SetLogPatch) => void;
  onSwap: (slot: PlannedSlot) => void;
  toggleWarmupSet: (slot: PlannedSlot, index: number, done: boolean) => void;
}

/** Sessions from before v1.6 have no targetRpe on the slot but always had a goal: fall back to the suggestion's. */
const goalOf = (slot: PlannedSlot): number | null => (slot.rule === 'linear' ? slot.targetRpe ?? null : slot.targetRpe ?? slot.suggestion.targetRpe);
const pillText = (slot: PlannedSlot, done: boolean) => {
  const goal = goalOf(slot);
  return `${slot.sets} × ${fmtRepTarget(slot.suggestion.repTarget)}${goal != null ? ` @ ${goal}` : ''}${done ? ' ✓' : ''}`;
};
const statusOf = (slot: PlannedSlot, l: SetLog) => classifySet(slot.suggestion.repTarget, goalOf(slot), l.reps, l.rpe);
const rowsDone = (rows: SetLog[]) => rows.length > 0 && rows.every((l) => l.reps != null);

/** The suggestion, last set 1, intro note, and any swap / add note for one slot. */
function SlotHints({ slot }: { slot: PlannedSlot }) {
  const s = slot.suggestion;
  const beat = s.repTarget.kind === 'range' ? s.repTarget.beat : null;
  return (
    <>
      <p class="hint muted">
        {s.load == null
          ? slot.bodyweight ? 'First session — leave the load empty for bodyweight, or type the added weight' : 'First session — type set 1’s load; it fills the rest'
          : `Suggested ${fmtLoadBw(s.load, slot.bodyweight)} · ${reasonText(s.reason)}`}
        {beat != null && <span class="badge"> beat {beat}</span>}
        {s.confidence === 'low' && <span class="badge badge-warn">low confidence</span>}
        {s.bigJump && <span class="badge badge-warn">big jump</span>}
      </p>
      {s.basis && (
        <p class="hint muted">Last set 1: {fmtLoadBw(s.basis.load, slot.bodyweight)} × {s.basis.reps} @ {fmtRpe(s.basis.rpe)}</p>
      )}
      {slot.fullSets != null && <p class="hint small muted">Intro weeks — {slot.sets} of the usual {slot.fullSets} sets</p>}
      {slot.change && <p class="hint small changed">{changeText(slot.change)}</p>}
    </>
  );
}

function WarmupChips({ slot, toggle }: { slot: PlannedSlot; toggle: (index: number, done: boolean) => void }) {
  if (!slot.warmupSets || slot.warmupSets.length === 0) return null;
  return (
    <div class="warmup-sets">
      <span class="warmup-label">Warm-up</span>
      {slot.warmupSets.map((w, i) => (
        <label key={i} class={`warmup-set ${w.done ? 'done' : ''}`}>
          <input type="checkbox" checked={w.done} aria-label={`${slot.exerciseName} warm-up ${fmtLoadBw(w.load, slot.bodyweight)} × ${w.reps}`} onChange={(e) => toggle(i, e.currentTarget.checked)} />
          <span>{fmtLoadBw(w.load, slot.bodyweight)} × {w.reps}</span>
        </label>
      ))}
    </div>
  );
}

function Summary({ slot, rows }: { slot: PlannedSlot; rows: SetLog[] }) {
  const logged = rows.filter((l) => l.reps != null);
  if (!logged.length) return <span class="muted">Not logged yet</span>;
  return (
    <>
      {logged.map((l, i) => (
        <Fragment key={l.id}>
          {i > 0 && ' · '}
          <span class={`sum ${statusOf(slot, l)}`}>{l.load != null ? fmtLoadBw(l.load, slot.bodyweight) : slot.bodyweight ? 'BW' : '?'} × {l.reps}{l.rpe != null ? ` @ ${l.rpe}` : ''}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Set 1's load copies down to the later sets that still share the "basis" (the prefilled suggestion, or whatever
 * set 1 last pushed to them); clearing set 1 never clears them. One basis per slot, so a superset card can share it.
 */
function useCopyDown(slots: PlannedSlot[], rowsOf: (slot: PlannedSlot) => SetLog[], update: CardCallbacks['update']) {
  const basis = useRef<Record<string, number | null>>({});
  for (const slot of slots) {
    if (!(slot.slotId in basis.current)) basis.current[slot.slotId] = rowsOf(slot).find((r) => r.setNumber === 1)?.load ?? null;
  }
  return (slot: PlannedSlot, log: SetLog, v: number | undefined) => {
    update(log.id, { load: v });
    if (log.setNumber !== 1 || v == null) return;
    for (const id of copyDownTargets(rowsOf(slot), log, basis.current[slot.slotId] ?? null, v)) update(id, { load: v });
    basis.current[slot.slotId] = v;
  };
}

interface RowProps {
  slot: PlannedSlot;
  log: SetLog;
  /** Superset tag shown before the set number, e.g. "A1". */
  tag?: string;
  open: boolean;
  onToggleRpe: () => void;
  onLoad: (v: number | undefined) => void;
  update: CardCallbacks['update'];
}

function SetRow({ slot, log, tag, open, onToggleRpe, onLoad, update }: RowProps) {
  const st = statusOf(slot, log);
  const name = tag ? `${slot.exerciseName} set ${log.setNumber}` : `Set ${log.setNumber}`;
  return (
    <div class={`set-row ${tag ? 'ss' : ''} ${st}`}>
      <span class="set-no" aria-label={`${name}${st !== 'pending' ? `, ${st}` : ''}`}>{tag && <span class="order-tag">{tag}</span>}{log.setNumber}</span>
      <NumberField value={log.load} onChange={onLoad} mode="decimal" label={`${name} load`} min={0} placeholder={slot.bodyweight ? 'BW' : 'lb'} />
      <NumberField value={log.reps} onChange={(v) => update(log.id, { reps: v })} mode="numeric" label={`${name} reps`} min={0} placeholder="reps" />
      <button
        type="button"
        class={`rpe-chip ${log.rpe == null ? 'is-empty' : ''} ${log.rpe != null ? st : ''} ${open ? 'open' : ''}`}
        aria-label={`${name} RPE${st !== 'pending' ? `, ${st}` : ''}`}
        aria-expanded={open}
        onClick={onToggleRpe}
      >
        {log.rpe == null ? 'RPE' : log.rpe}
      </button>
      {open && (
        <div class="set-rpe">
          <RpePicker
            compact
            targetRpe={goalOf(slot) ?? undefined}
            value={log.rpe}
            onChange={(v) => {
              update(log.id, { rpe: v });
              onToggleRpe();
            }}
            label={`${name} RPE picker`}
          />
        </div>
      )}
    </div>
  );
}

function SetHead({ ss, bodyweight }: { ss?: boolean; bodyweight?: boolean }) {
  return <div class={`set-head ${ss ? 'ss' : ''}`}><span>Set</span><span>{bodyweight ? 'Added (lb)' : 'Load (lb)'}</span><span>Reps</span><span>RPE</span></div>;
}

function ExerciseCard({ slot, label, logs, update, onSwap, toggleWarmupSet }: CardCallbacks & { slot: PlannedSlot; label: string; logs: SetLog[] }) {
  const rows = [...logs].sort((a, b) => a.setNumber - b.setNumber);
  const done = rowsDone(rows);
  const [collapsed, setCollapsed] = useState(false);
  const [openRpe, setOpenRpe] = useState<string | null>(null);
  const onLoad = useCopyDown([slot], () => rows, update);

  return (
    <li class={`card ${done ? 'is-done' : ''}`}>
      <CardHead title={slot.exerciseName} tag={label} pill={pillText(slot, done)} pillClass={done ? 'pill-ok' : ''} expanded={!collapsed} onToggle={() => setCollapsed(!collapsed)} />
      {collapsed ? (
        <p class="summary muted"><Summary slot={slot} rows={rows} /></p>
      ) : (
        <>
          <SlotHints slot={slot} />
          <WarmupChips slot={slot} toggle={(i, d) => toggleWarmupSet(slot, i, d)} />
          <SetHead bodyweight={slot.bodyweight} />
          {rows.map((log) => (
            <SetRow key={log.id} slot={slot} log={log} open={openRpe === log.id} onToggleRpe={() => setOpenRpe(openRpe === log.id ? null : log.id)} onLoad={(v) => onLoad(slot, log, v)} update={update} />
          ))}
          <div class="card-foot">
            <button type="button" class="btn btn-small btn-ghost" onClick={() => onSwap(slot)}>Swap exercise</button>
          </div>
        </>
      )}
    </li>
  );
}

/** 5A / 5B (…): one card, sets interleaved by round in the order they are done. */
function SupersetCard({ slots, labels, logsOf, update, onSwap, toggleWarmupSet }: CardCallbacks & { slots: PlannedSlot[]; labels: string[]; logsOf: (slot: PlannedSlot) => SetLog[] }) {
  const rowsOf = (slot: PlannedSlot) => [...logsOf(slot)].sort((a, b) => a.setNumber - b.setNumber);
  const tag = (i: number) => labels[i];
  const allRows = slots.flatMap(rowsOf);
  const doneCount = allRows.filter((l) => l.reps != null).length;
  const done = allRows.length > 0 && doneCount === allRows.length;
  const [collapsed, setCollapsed] = useState(false);
  const [openRpe, setOpenRpe] = useState<string | null>(null);
  const onLoad = useCopyDown(slots, rowsOf, update);
  const rounds = Math.max(0, ...slots.map((s) => s.sets));
  const anyBodyweight = slots.some((s) => s.bodyweight);

  return (
    <li class={`card ${done ? 'is-done' : ''}`}>
      <CardHead
        title={slots.map((s) => s.exerciseName).join(' · ')}
        tag={labels.join(' / ')}
        pill={done ? `${doneCount}/${allRows.length} ✓` : `${doneCount}/${allRows.length} sets`}
        pillClass={done ? 'pill-ok' : ''}
        expanded={!collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      {collapsed ? (
        slots.map((s, i) => (
          <p key={s.slotId} class="summary muted"><span class="order-tag">{tag(i)}</span><Summary slot={s} rows={rowsOf(s)} /></p>
        ))
      ) : (
        <>
          {slots.map((s, i) => (
            <div key={s.slotId} class="ss-block">
              <div class="ss-name">
                <span><span class="order-tag">{tag(i)}</span>{s.exerciseName}</span>
                <span class={`pill ${rowsDone(rowsOf(s)) ? 'pill-ok' : ''}`}>{pillText(s, rowsDone(rowsOf(s)))}</span>
              </div>
              <SlotHints slot={s} />
              <WarmupChips slot={s} toggle={(j, d) => toggleWarmupSet(s, j, d)} />
            </div>
          ))}
          <SetHead ss bodyweight={anyBodyweight} />
          {Array.from({ length: rounds }, (_, r) => r + 1).map((round) =>
            slots.map((s, i) => {
              const log = rowsOf(s).find((l) => l.setNumber === round);
              if (!log) return null;
              return <SetRow key={log.id} slot={s} log={log} tag={tag(i)} open={openRpe === log.id} onToggleRpe={() => setOpenRpe(openRpe === log.id ? null : log.id)} onLoad={(v) => onLoad(s, log, v)} update={update} />;
            }),
          )}
          <div class="card-foot">
            {slots.map((s, i) => (
              <button type="button" key={s.slotId} class="btn btn-small btn-ghost" onClick={() => onSwap(s)}>Swap {tag(i)}</button>
            ))}
          </div>
        </>
      )}
    </li>
  );
}
