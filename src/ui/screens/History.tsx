import { getExerciseHistory, getExercisesWithHistory } from '../../db/queries';
import { useLiveQuery } from '../../db/useLiveQuery';
import { fmtDate, fmtLoadBw, fmtRpe } from '../format';
import { navigate } from '../router';

export function History({ exerciseId }: { exerciseId?: string }) {
  const exercises = useLiveQuery(() => getExercisesWithHistory(), []);
  const entries = useLiveQuery(() => (exerciseId ? getExerciseHistory(exerciseId) : Promise.resolve(null)), [exerciseId]);

  if (exercises === undefined) return <main class="screen" />;

  const selected = exercises.find((e) => e.id === exerciseId);

  return (
    <main class="screen">
      <h1>History</h1>
      {exercises.length === 0 ? (
        <div class="empty"><p>Finish a session to see history here.</p></div>
      ) : (
        <>
          <label class="field">
            Exercise
            <select value={exerciseId ?? ''} onChange={(e) => navigate(e.currentTarget.value ? `/history/${e.currentTarget.value}` : '/history')}>
              <option value="">Choose…</option>
              {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          {selected && entries && (
            <ul class="list" style="margin-top:12px">
              {entries.map(({ session, sets, e1rm }) => (
                <li key={session.id} class="card">
                  <div class="row between">
                    <strong>{fmtDate(session.finishedAt)}</strong>
                    <span class="muted small">{session.dayName}</span>
                  </div>
                  <table class="sets">
                    <thead><tr><th>Set</th><th>Load</th><th>Reps</th><th>RPE</th></tr></thead>
                    <tbody>
                      {sets.map((s) => (
                        <tr key={s.setNumber}><td>{s.setNumber}</td><td>{fmtLoadBw(s.load, selected.bodyweight)}</td><td>{s.reps}</td><td>{fmtRpe(s.rpe)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div class="small muted">e1RM from set 1: {e1rm == null ? '—' : Math.round(e1rm)}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
