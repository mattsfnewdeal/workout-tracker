import { useCallback, useEffect, useState } from 'preact/hooks';
import { db } from '../db/db';
import { setWarmupDone, updateSetLog, type SetLogPatch } from '../db/ops';
import { getSessionLogs } from '../db/queries';
import type { Session, SetLog } from '../model/types';

export interface SessionState {
  session: Session;
  logs: SetLog[];
}

/**
 * Local state drives the inputs; every change is written through to Dexie
 * immediately so a force-quit loses nothing. `undefined` = loading, `null` = not found.
 */
export function useActiveSession(sessionId: string) {
  const [state, setState] = useState<SessionState | null | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setState(undefined);
    (async () => {
      const session = await db.sessions.get(sessionId);
      if (!alive) return;
      if (!session) {
        setState(null);
        return;
      }
      const logs = await getSessionLogs(sessionId);
      if (alive) setState({ session, logs });
    })().catch((e) => {
      console.error(e);
      if (alive) setState(null);
    });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const update = useCallback((id: string, patch: SetLogPatch) => {
    setState((s) => (s ? { ...s, logs: s.logs.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : s));
    updateSetLog(id, patch).then(
      () => setSaveError(null),
      (e: Error) => setSaveError(`Couldn’t save: ${e.message}`),
    );
  }, []);

  const toggleWarmup = useCallback((itemId: string, done: boolean) => {
    setState((s) => (s ? { ...s, session: { ...s.session, warmups: (s.session.warmups ?? []).map((w) => (w.id === itemId ? { ...w, done } : w)) } } : s));
    setWarmupDone(sessionId, itemId, done).then(
      () => setSaveError(null),
      (e: Error) => setSaveError(`Couldn’t save: ${e.message}`),
    );
  }, [sessionId]);

  return { state, update, toggleWarmup, saveError };
}
