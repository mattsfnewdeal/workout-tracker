import { useState } from 'preact/hooks';
import { DEFAULT_TARGET_RPE } from '../../engine';
import { normalizeName } from '../../db/ops';
import { getAllExercises } from '../../db/queries';
import { useLiveQuery } from '../../db/useLiveQuery';
import type { ChangeScope, PlannedSlot, SlotSpec } from '../../model/types';
import { specOf } from '../../state/slotChanges';
import { ConfirmDialog } from './ConfirmDialog';
import { SlotFields } from './SlotFields';

export type SlotDialogMode = { kind: 'swap'; slot: PlannedSlot } | { kind: 'add' };

interface Props {
  mode: SlotDialogMode | null;
  dayName: string;
  onCancel: () => void;
  /** Resolves when the change is saved; rejects with a message to show. */
  /** `bodyweight` is undefined when the lifter never touched the box: the exercise keeps its flag. */
  onSubmit: (exerciseName: string, spec: SlotSpec, scope: ChangeScope, bodyweight: boolean | undefined) => Promise<void>;
}

const DEFAULT_SPEC: SlotSpec = { sets: 3, progression: 'single', targetReps: 5, targetRpe: DEFAULT_TARGET_RPE };

/** Swap one exercise for another, or add one, for this session only or for the program's day as well. */
export function SlotDialog({ mode, ...rest }: Props) {
  // The form unmounts when closed so every open starts from the slot as it is now, with nothing left over from last time.
  if (!mode) return null;
  return <SlotForm key={mode.kind === 'swap' ? mode.slot.slotId : 'add'} mode={mode} {...rest} />;
}

function SlotForm({ mode, dayName, onCancel, onSubmit }: Props & { mode: SlotDialogMode }) {
  const exercises = useLiveQuery(() => getAllExercises(), []) ?? [];
  const [name, setName] = useState('');
  const [spec, setSpec] = useState<SlotSpec>(() => (mode.kind === 'swap' ? specOf(mode.slot) : DEFAULT_SPEC));
  const [scope, setScope] = useState<ChangeScope>('session');
  const [bodyweight, setBodyweight] = useState(false);
  const [bwTouched, setBwTouched] = useState(false);
  const lower = normalizeName(name).toLowerCase(); // the same match findOrCreateExercise makes
  const existing = exercises.find((e) => e.name.toLowerCase() === lower);
  // An existing exercise's flag shows as soon as its name is typed, unless the box was set by hand.
  const bwShown = bwTouched ? bodyweight : !!existing?.bodyweight;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const swap = mode.kind === 'swap' ? mode.slot : null;
  const verb = swap ? 'Swap' : 'Add';

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name, spec, scope, bwTouched ? bodyweight : undefined);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog open title={swap ? `Swap ${swap.exerciseName}` : 'Add an exercise'} confirmLabel={busy ? 'Saving…' : verb} onCancel={onCancel} onConfirm={submit}>
      <label class="field">
        {swap ? 'Replace with' : 'Exercise'}
        <input
          class="text"
          type="text"
          list="slot-dialog-exercises"
          aria-label="Exercise name"
          placeholder="Exercise name"
          autocomplete="off"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
        />
        <datalist id="slot-dialog-exercises">
          {exercises.map((e) => <option key={e.id} value={e.name} />)}
        </datalist>
      </label>
      <label class="check" style="min-height:36px; margin-top:8px">
        <input type="checkbox" checked={bwShown} onChange={(e) => { setBwTouched(true); setBodyweight(e.currentTarget.checked); }} />
        <span>Bodyweight<span class="muted small"> · load is added weight, leave empty for none</span></span>
      </label>
      <SlotFields slot={spec} onChange={setSpec} />
      <div class="stack" style="margin-top:14px" role="radiogroup" aria-label="Apply to">
        <label class="check">
          <input type="radio" name="slot-change-scope" value="session" checked={scope === 'session'} onChange={() => setScope('session')} />
          <span>Just this session</span>
        </label>
        <label class="check">
          <input type="radio" name="slot-change-scope" value="program" checked={scope === 'program'} onChange={() => setScope('program')} />
          <span>
            This and future sessions
            <span class="muted small"> · {swap ? `replaces ${swap.exerciseName} on ${dayName}` : `added to ${dayName}`} in the program</span>
          </span>
        </label>
      </div>
      {swap && <p class="small" style="margin:10px 0 0">Anything already logged for {swap.exerciseName} today is discarded.</p>}
      {error && <p class="error small" style="margin:10px 0 0">{error}</p>}
    </ConfirmDialog>
  );
}
