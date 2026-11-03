import { useState } from 'preact/hooks';
import { reasonText } from '../../engine';
import { getActiveProgram, getInProgressSession } from '../../db/queries';
import { abandonSession, startSession } from '../../db/ops';
import { useLiveQuery } from '../../db/useLiveQuery';
import { buildPlan } from '../../state/plan';
import type { PlannedSlot } from '../../model/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { fmtAgo, fmtDate, fmtLoad, fmtRepTarget, fmtRpe, fmtSuggestion } from '../format';
import { navigate } from '../router';

export function Today() {
  const inProgress = useLiveQuery(() => getInProgressSession(), []);
  const plan = useLiveQuery(async () => {
    const program = await getActiveProgram();
    if (!program) return null;
    const dayIndex = program.days.length ? program.nextDayIndex % program.days.length : 0;
    return { program, day: program.days[dayIndex], dayIndex, slots: await buildPlan(program, dayIndex) };
  }, []);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (plan === undefined || inProgress === undefined) return <main class="screen" />;

  if (plan === null) {
    return (
      <main class="screen">
        <h1>Today</h1>
        <div class="empty">
          <p>No program yet.</p>
          <button type="button" class="btn btn-primary btn-big" onClick={() => navigate('/program')}>Build a program</button>
        </div>
      </main>
    );
  }

  const { program, day, slots } = plan;

  async function start() {
    if (!plan) return;
    setStarting(true);
    setError(null);
    try {
      const session = await startSession(plan.program, plan.dayIndex, plan.slots);
      navigate(`/log/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <main class="screen">
      <h1>Today</h1>
      <p class="muted">{program.name}</p>

      {inProgress && (
        <section class="card banner">
          <div>
            <strong>{inProgress.dayName} in progress</strong>
            <div class="muted">started {fmtAgo(inProgress.startedAt)}</div>
          </div>
          <div class="row gap">
            <button type="button" class="btn" onClick={() => setConfirmAbandon(true)}>Abandon</button>
            <button type="button" class="btn btn-primary" onClick={() => navigate(`/log/${inProgress.id}`)}>Resume</button>
          </div>
        </section>
      )}

      {!day ? (
        <div class="empty">
          <p>This program has no days.</p>
          <button type="button" class="btn" onClick={() => navigate('/program')}>Edit program</button>
        </div>
      ) : (
        <>
          <h2>Next: {day.name}</h2>
          {(day.warmups ?? []).length > 0 && (
            <p class="muted small" style="margin:-4px 0 8px">Warm-up: {(day.warmups ?? []).map((w) => w.name).join(', ')}</p>
          )}
          {slots.length === 0 ? (
            <div class="empty">
              <p>{day.name} has no exercises yet.</p>
              <button type="button" class="btn" onClick={() => navigate('/program')}>Edit program</button>
            </div>
          ) : (
            <ul class="list">
              {slots.map((s) => <SlotCard key={s.slotId} slot={s} />)}
            </ul>
          )}
          {error && <p class="error">{error}</p>}
          {!inProgress && slots.length > 0 && (
            <button type="button" class="btn btn-primary btn-big" disabled={starting} onClick={start}>
              Start {day.name}
            </button>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmAbandon}
        title="Abandon this session?"
        confirmLabel="Abandon"
        danger
        onCancel={() => setConfirmAbandon(false)}
        onConfirm={async () => {
          if (inProgress) await abandonSession(inProgress.id);
          setConfirmAbandon(false);
        }}
      >
        Logged sets will be deleted. The day pointer won’t move.
      </ConfirmDialog>
    </main>
  );
}

function SlotCard({ slot }: { slot: PlannedSlot }) {
  const s = slot.suggestion;
  const beat = s.repTarget.kind === 'range' ? s.repTarget.beat : null;
  return (
    <li class="card">
      <div class="row between">
        <strong>{slot.exerciseName}</strong>
        <span class="muted">{slot.sets} sets</span>
      </div>
      <div class="big-number">
        {fmtSuggestion(s)}
        {beat != null && <span class="muted"> · beat {beat}</span>}
      </div>
      <div class="row gap wrap">
        <span class="muted small">{reasonText(s.reason)}</span>
        {s.confidence === 'low' && <span class="badge badge-warn">low confidence</span>}
        {s.bigJump && <span class="badge badge-warn">big jump</span>}
      </div>
      {s.basis && (
        <div class="small muted">
          Last set 1: {fmtLoad(s.basis.load)} × {s.basis.reps} @ {fmtRpe(s.basis.rpe)}
          {slot.lastSessionAt ? ` · ${fmtDate(slot.lastSessionAt)}` : ''}
          {s.repTarget.kind === 'fixed' ? '' : ` (range ${fmtRepTarget(s.repTarget)})`}
        </div>
      )}
    </li>
  );
}
