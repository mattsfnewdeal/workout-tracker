import { useEffect, useRef, useState } from 'preact/hooks';
import { backupCounts, exportBackup, getLastBackupAt, importBackup, parseBackup, type Backup } from '../../db/backup';
import { resetAll } from '../../db/ops';
import { useLiveQuery } from '../../db/useLiveQuery';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { fmtDateTime } from '../format';

export function Settings() {
  const lastBackupAt = useLiveQuery(() => getLastBackupAt(), []);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);

  async function onExport() {
    try {
      const done = await exportBackup();
      setMessage(done ? { kind: 'ok', text: 'Backup exported' } : null);
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      setPending(parseBackup(await file.text()));
      setMessage(null);
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    }
  }

  async function doImport() {
    if (!pending) return;
    try {
      await importBackup(pending);
      setMessage({ kind: 'ok', text: 'Backup imported' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setPending(null);
    }
  }

  const counts = pending ? backupCounts(pending) : null;

  return (
    <main class="screen">
      <h1>Settings</h1>

      <h2>Backup</h2>
      <p class="muted small">
        Safari can clear web app storage. Export a backup regularly and keep it in Files or iCloud.
        {persisted === false && ' Storage is not marked persistent on this device.'}
        {persisted === true && ' Storage is marked persistent.'}
      </p>
      <p>Last backup: <strong>{lastBackupAt ? fmtDateTime(lastBackupAt) : 'never'}</strong></p>
      <div class="row gap">
        <button type="button" class="btn btn-primary grow" onClick={onExport}>Export JSON</button>
        <button type="button" class="btn grow" onClick={() => fileRef.current?.click()}>Import JSON</button>
        <input ref={fileRef} type="file" accept=".json,application/json" style="display:none" onChange={onFile} />
      </div>
      {message && <p class={message.kind === 'ok' ? 'ok' : 'error'}>{message.text}</p>}

      <hr />
      <h2>Danger zone</h2>
      <button type="button" class="btn btn-danger" onClick={() => setConfirmReset(true)}>Reset all data</button>

      <hr />
      <p class="muted small">Workout Tracker · loads in lb · RPE per RTS/Barbell Medicine conventions.</p>

      <ConfirmDialog
        open={pending !== null}
        title="Replace everything?"
        confirmLabel="Import"
        danger
        onCancel={() => setPending(null)}
        onConfirm={doImport}
      >
        {counts && `This replaces all current data with ${counts.exercises} exercises, ${counts.programs} programs, ${counts.sessions} sessions and ${counts.setLogs} sets from ${fmtDateTime(Date.parse(pending!.exportedAt))}.`}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmReset}
        title="Delete all data?"
        confirmLabel="Reset"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await resetAll();
          setConfirmReset(false);
          setMessage({ kind: 'ok', text: 'All data deleted' });
        }}
      >
        Programs, sessions and history on this device will be deleted. Export a backup first if you want to keep them.
      </ConfirmDialog>
    </main>
  );
}
