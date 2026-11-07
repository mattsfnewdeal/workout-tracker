import { DEFAULT_TARGET_RPE } from '../../engine';
import { switchProgression } from '../../db/ops';
import type { ProgressionRule, Slot, SlotSpec } from '../../model/types';
import { NumberField } from './NumberField';
import { RpePicker } from './RpePicker';

const MODES: { value: Slot['progression']; label: string; hint: string }[] = [
  { value: 'single', label: 'Fixed reps', hint: 'Load goes up once every set hits the target.' },
  { value: 'double', label: 'Rep range', hint: 'Same load until set 1 beats the top of the range, then load goes up.' },
];
const RULES: { value: ProgressionRule; label: string; hint: string }[] = [
  { value: 'rpe', label: 'By RPE', hint: 'Next load comes from set 1’s e1RM at the RPE goal.' },
  { value: 'linear', label: 'Linear', hint: 'Add one increment when every set hits the target: fixed reps, or the top of a range at or under the RPE goal. Fixed reps drop 10% after two misses in a row.' },
  { value: 'manual', label: 'Manual', hint: 'No suggestion beyond last time’s load. Progress by feel, guided by the note.' },
];

interface Props<T extends SlotSpec> {
  slot: T;
  onChange: (s: T) => void;
  /** Show the intro-weeks set count (the program has intro weeks). */
  showIntro?: boolean;
}

function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <div
      class="row gap"
      role="radiogroup"
      aria-label={label}
      style="margin-top:8px"
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const i = options.findIndex((o) => o.value === value);
        const next = options[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? options.length - 1 : 1)) % options.length].value;
        onChange(next);
        (e.currentTarget.querySelector(`[data-value="${next}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          data-value={o.value}
          class={`btn grow ${value === o.value ? 'btn-primary' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Sets, fixed reps or a rep range, the progression rule and the RPE goal. Used by the program builder and the swap / add dialog. */
export function SlotFields<T extends SlotSpec>({ slot, onChange, showIntro }: Props<T>) {
  const mode = MODES.find((m) => m.value === slot.progression) ?? MODES[0];
  const rule: ProgressionRule = slot.rule ?? 'rpe';
  const ruleInfo = RULES.find((r) => r.value === rule) ?? RULES[0];
  const intro = (slot as { introSets?: number }).introSets;

  /** Switching keeps the numbers already typed: Fixed 5 → Range 5–7, Range 6–8 → Fixed 6. */
  const setMode = (progression: Slot['progression']) => {
    if (progression !== slot.progression) onChange(switchProgression(slot, progression));
  };
  const setRule = (r: ProgressionRule) => {
    const next = { ...slot } as T & { rule?: ProgressionRule };
    if (r === 'rpe') {
      delete next.rule;
      next.targetRpe ??= DEFAULT_TARGET_RPE; // by-RPE needs a goal: it sets the load
    } else next.rule = r;
    onChange(next);
  };
  const setIntro = (v: number | undefined) => {
    const next = { ...slot } as T & { introSets?: number };
    if (v == null) delete next.introSets;
    else next.introSets = v;
    onChange(next);
  };

  return (
    <>
      <Segmented label="Reps" value={slot.progression} options={MODES} onChange={setMode} />
      <p class="muted small" style="margin:6px 0 0">{mode.hint}</p>
      <Segmented label="Progression" value={rule} options={RULES} onChange={setRule} />
      <p class="muted small" style="margin:6px 0 0">{ruleInfo.hint}</p>
      <div class="row gap" style="margin-top:8px">
        <label class="field grow">
          Sets
          <NumberField value={slot.sets} onChange={(v) => onChange({ ...slot, sets: v ?? 1 })} mode="numeric" min={1} />
        </label>
        {showIntro && (
          <label class="field grow">
            Intro sets
            <NumberField value={intro} onChange={setIntro} mode="numeric" min={1} placeholder="same" />
          </label>
        )}
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
        {rule === 'rpe' ? 'RPE goal' : rule === 'linear' ? 'RPE goal (optional — a range only moves up at or under it; tap again to clear)' : 'RPE goal (optional — colours sets; tap again to clear)'}
        <RpePicker
          compact
          value={slot.targetRpe}
          onChange={(v) => {
            const next = { ...slot };
            if (v == null && rule !== 'rpe') delete next.targetRpe;
            else next.targetRpe = v ?? DEFAULT_TARGET_RPE;
            onChange(next);
          }}
          label="RPE goal"
        />
      </label>
      <label class="field" style="margin-top:8px">
        Note
        <input
          class="text"
          type="text"
          value={(slot as { note?: string }).note ?? ''}
          placeholder="per leg, cues, how to progress…"
          onInput={(e) => {
            const next = { ...slot } as T & { note?: string };
            const v = e.currentTarget.value;
            if (v.trim()) next.note = v; else delete next.note;
            onChange(next);
          }}
        />
      </label>
    </>
  );
}
