import { Fragment } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { classifySet, reasonText } from '../../engine';
import { abandonSession, checkFinish, finishSession, type SetLogPatch } from '../../db/ops';
import type { PlannedSlot, SetLog, WarmupLog } from '../../model/types';
import { copyDownTargets } from '../../state/copyDown';
import { useActiveSession } from '../../state/useActiveSession';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NumberField } from '../components/NumberField';
import { RpePicker } from '../components/RpePicker';
import { fmtDate, fmtLoad, fmtRepTarget, fmtRpe } from '../format';
import { navigate } from '../router';

function slotDone(slot: PlannedSlot, logs: SetLog[]): boolean {
  const rows = logs.filter((l) => l.slotId === slot.slotId);
  return rows.length > 0 && rows.every((l) => l.reps != null);
}

export function LogSession({ sessionId }: { sessionId: string }) {
  const { state, update, toggleWarmup, saveError } = useActiveSession(sessionId);
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
        {session.plan.map((slot) => (
          <ExerciseCard key={slot.slotId} slot={slot} logs={logs.filter((l) => l.slotId === slot.slotId)} update={update} />
        ))}
      </ul>

      {saveError && <p class="error">{saveError}</p>}
      {problems.length > 0 && (
        <ul class="error problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div class="sticky-bottom">
        <button type="button" class="btn btn-primary btn-big" disabled={busy} onClick={tryFinish}>Finish</button>
      </div>

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

function CardHead({ title, pill, pillClass, expanded, onToggle }: { title: string; pill: string; pillClass?: string; expanded: boolean; onToggle: () => void }) {
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
      <span class="card-title">{title}</span>
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

function ExerciseCard({ slot, logs, update }: { slot: PlannedSlot; logs: SetLog[]; update: (id: string, patch: SetLogPatch) => void }) {
  const s = slot.suggestion;
  const beat = s.repTarget.kind === 'range' ? s.repTarget.beat : null;
  const rows = [...logs].sort((a, b) => a.setNumber - b.setNumber);
  const done = rows.length > 0 && rows.every((l) => l.reps != null);
  const [collapsed, setCollapsed] = useState(false);
  const [openRpe, setOpenRpe] = useState<string | null>(null);

  /** The load the linked later sets currently share: the prefilled suggestion, or whatever set 1 last pushed to them. */
  const basis = useRef<number | null>(rows.find((r) => r.setNumber === 1)?.load ?? null);

  /** Typing set 1's load fills the later sets that still match the basis; clearing set 1 never clears them. */
  function onLoad(log: SetLog, v: number | undefined) {
    update(log.id, { load: v });
    if (log.setNumber !== 1 || v == null) return;
    for (const id of copyDownTargets(rows, log, basis.current, v)) update(id, { load: v });
    basis.current = v;
  }

  const status = (l: SetLog) => classifySet(s.repTarget, s.targetRpe, l.reps, l.rpe);
  const summary = rows
    .filter((l) => l.reps != null)
    .map((l, i) => (
      <Fragment key={l.id}>
        {i > 0 && ' · '}
        <span class={`sum ${status(l)}`}>{l.load != null ? fmtLoad(l.load) : '?'} × {l.reps}{l.rpe != null ? ` @ ${l.rpe}` : ''}</span>
      </Fragment>
    ));

  return (
    <li class={`card ${done ? 'is-done' : ''}`}>
      <CardHead
        title={slot.exerciseName}
        pill={`${slot.sets} × ${fmtRepTarget(s.repTarget)} @ ${s.targetRpe}${done ? ' ✓' : ''}`}
        pillClass={done ? 'pill-ok' : ''}
        expanded={!collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      {collapsed ? (
        <p class="summary muted">{summary.length ? summary : 'Not logged yet'}</p>
      ) : (
        <>
          <p class="hint muted">
            {s.load == null ? 'First session — type set 1’s load; it fills the rest' : `Suggested ${fmtLoad(s.load)} · ${reasonText(s.reason)}`}
            {beat != null && <span class="badge"> beat {beat}</span>}
            {s.confidence === 'low' && <span class="badge badge-warn">low confidence</span>}
            {s.bigJump && <span class="badge badge-warn">big jump</span>}
          </p>
          {s.basis && (
            <p class="hint muted">Last set 1: {fmtLoad(s.basis.load)} × {s.basis.reps} @ {fmtRpe(s.basis.rpe)}</p>
          )}
          <div class="set-head"><span>Set</span><span>Load (lb)</span><span>Reps</span><span>RPE</span></div>
          {rows.map((log) => {
            const st = status(log);
            const open = openRpe === log.id;
            return (
              <div key={log.id} class={`set-row ${st}`}>
                <span class="set-no" aria-label={`Set ${log.setNumber}${st !== 'pending' ? `, ${st}` : ''}`}>{log.setNumber}</span>
                <NumberField value={log.load} onChange={(v) => onLoad(log, v)} mode="decimal" label={`Set ${log.setNumber} load`} min={0} placeholder="lb" />
                <NumberField value={log.reps} onChange={(v) => update(log.id, { reps: v })} mode="numeric" label={`Set ${log.setNumber} reps`} min={0} placeholder="reps" />
                <button
                  type="button"
                  class={`rpe-chip ${log.rpe == null ? 'is-empty' : ''} ${log.rpe != null ? st : ''} ${open ? 'open' : ''}`}
                  aria-label={`Set ${log.setNumber} RPE${st !== 'pending' ? `, ${st}` : ''}`}
                  aria-expanded={open}
                  onClick={() => setOpenRpe(open ? null : log.id)}
                >
                  {log.rpe == null ? 'RPE' : log.rpe}
                </button>
                {open && (
                  <div class="set-rpe">
                    <RpePicker
                      compact
                      targetRpe={s.targetRpe}
                      value={log.rpe}
                      onChange={(v) => {
                        update(log.id, { rpe: v });
                        setOpenRpe(null);
                      }}
                      label={`Set ${log.setNumber} RPE picker`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </li>
  );
}
