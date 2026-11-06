import { DEFAULT_TARGET_RPE } from '../../engine';
import { switchProgression } from '../../db/ops';
import type { Slot, SlotSpec } from '../../model/types';
import { NumberField } from './NumberField';
import { RpePicker } from './RpePicker';

const MODES: { value: Slot['progression']; label: string; hint: string }[] = [
  { value: 'single', label: 'Fixed reps', hint: 'Load goes up once every set hits the target.' },
  { value: 'double', label: 'Rep range', hint: 'Same load until set 1 beats the top of the range, then load goes up.' },
];

interface Props<T extends SlotSpec> {
  slot: T;
  onChange: (s: T) => void;
}

/** Sets, fixed reps or a rep range, and the RPE goal. Used by the program builder and the swap / add dialog. */
export function SlotFields<T extends SlotSpec>({ slot, onChange }: Props<T>) {
  const mode = MODES.find((m) => m.value === slot.progression) ?? MODES[0];

  /** Switching keeps the numbers already typed: Fixed 5 → Range 5–7, Range 6–8 → Fixed 6. */
  const setMode = (progression: Slot['progression']) => {
    if (progression !== slot.progression) onChange(switchProgression(slot, progression));
  };

  return (
    <>
      <div
        class="row gap"
        role="radiogroup"
        aria-label="Reps"
        style="margin-top:8px"
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          const next: Slot['progression'] = slot.progression === 'single' ? 'double' : 'single';
          setMode(next);
          (e.currentTarget.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
        }}
      >
        {MODES.map((m) => (
          <button
            type="button"
            key={m.value}
            role="radio"
            aria-checked={slot.progression === m.value}
            tabIndex={slot.progression === m.value ? 0 : -1}
            data-mode={m.value}
            class={`btn grow ${slot.progression === m.value ? 'btn-primary' : ''}`}
            onClick={() => setMode(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p class="muted small" style="margin:6px 0 0">{mode.hint}</p>
      <div class="row gap" style="margin-top:8px">
        <label class="field grow">
          Sets
          <NumberField value={slot.sets} onChange={(v) => onChange({ ...slot, sets: v ?? 1 })} mode="numeric" min={1} />
        </label>
        {slot.progression === 'single' ? (
          <label class="field grow">
            Target reps
            <NumberField value={slot.targetReps} onChange={(v) => onChange({ ...slot, targetReps: v })} mode="numeric" min={1} />
          </label>
        ) : (
          <>
            <label class="field grow">
              Min reps
              <NumberField value={slot.repMin} onChange={(v) => onChange({ ...slot, repMin: v })} mode="numeric" min={1} />
            </label>
            <label class="field grow">
              Max reps
              <NumberField value={slot.repMax} onChange={(v) => onChange({ ...slot, repMax: v })} mode="numeric" min={1} />
            </label>
          </>
        )}
      </div>
      <label class="field" style="margin-top:8px">
        RPE goal
        <RpePicker compact value={slot.targetRpe} onChange={(v) => onChange({ ...slot, targetRpe: v ?? DEFAULT_TARGET_RPE })} label="RPE goal" />
      </label>
    </>
  );
}
