import { useState } from 'preact/hooks';
import { isOutsideWorkingRange, reasonText } from '../../engine';
import { abandonSession, checkFinish, finishSession, type SetLogPatch } from '../../db/ops';
import type { PlannedSlot, SetLog } from '../../model/types';
import { useActiveSession } from '../../state/useActiveSession';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NumberField } from '../components/NumberField';
import { RpePicker } from '../components/RpePicker';
import { fmtDate, fmtLoad, fmtRepTarget, fmtRpe } from '../format';
import { navigate } from '../router';

export function LogSession({ sessionId }: { sessionId: string }) {
  const { state, update, saveError } = useActiveSession(sessionId);
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
      <div class="row between">
        <div>
          <h1>{session.dayName}</h1>
          <p class="muted small">Started {fmtDate(session.startedAt)}</p>
        </div>
        <button type="button" class="btn btn-small btn-ghost" onClick={() => setConfirmAbandon(true)}>Abandon</button>
      </div>

      <ul class="list">
        {session.plan.map((slot) => (
          <SlotLog key={slot.slotId} slot={slot} logs={logs.filter((l) => l.slotId === slot.slotId)} update={update} />
        ))}
      </ul>

      {saveError && <p class="error">{saveError}</p>}
      {problems.length > 0 && (
        <ul class="error">
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

function SlotLog({ slot, logs, update }: { slot: PlannedSlot; logs: SetLog[]; update: (id: string, patch: SetLogPatch) => void }) {
  const s = slot.suggestion;
  const beat = s.repTarget.kind === 'range' ? s.repTarget.beat : null;
  const rows = [...logs].sort((a, b) => a.setNumber - b.setNumber);

  /** Changing set 1's load also moves later sets that still sit at the old value. */
  function onLoad(log: SetLog, v: number | undefined) {
    update(log.id, { load: v });
    if (log.setNumber === 1 && v != null) {
      for (const other of rows) {
        if (other.id !== log.id && (other.load ?? null) === (log.load ?? null)) update(other.id, { load: v });
      }
    }
  }

  return (
    <li class="card">
      <div class="row between">
        <strong>{slot.exerciseName}</strong>
        <span class="muted small">{slot.sets} × {fmtRepTarget(s.repTarget)} @ {s.targetRpe}</span>
      </div>
      <div class="row gap wrap small">
        <span class="muted">{s.load == null ? 'First session \u2014 type set 1\u2019s load; it fills the rest' : `Suggested ${fmtLoad(s.load)} \u00b7 ${reasonText(s.reason)}`}</span>
        {beat != null && <span class="badge">beat {beat}</span>}
        {s.confidence === 'low' && <span class="badge badge-warn">low confidence</span>}
        {s.bigJump && <span class="badge badge-warn">big jump</span>}
      </div>
      {s.basis && (
        <div class="small muted">
          Last set 1: {fmtLoad(s.basis.load)} × {s.basis.reps} @ {fmtRpe(s.basis.rpe)}
        </div>
      )}
      <div class="set-head"><span>#</span><span>Load (lb)</span><span>Reps</span></div>
      {rows.map((log) => (
        <div key={log.id} class={`set-row ${log.rpe != null && isOutsideWorkingRange(log.rpe) ? 'outside' : ''}`}>
          <span class="set-no">{log.setNumber}</span>
          <NumberField value={log.load} onChange={(v) => onLoad(log, v)} mode="decimal" label={`Set ${log.setNumber} load`} min={0} placeholder="lb" />
          <NumberField value={log.reps} onChange={(v) => update(log.id, { reps: v })} mode="numeric" label={`Set ${log.setNumber} reps`} min={0} placeholder="reps" />
          <div class="set-rpe">
            <RpePicker compact value={log.rpe} onChange={(v) => update(log.id, { rpe: v })} label={`Set ${log.setNumber} RPE`} />
          </div>
        </div>
      ))}
    </li>
  );
}
