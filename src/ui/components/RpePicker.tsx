import { isOutsideWorkingRange, rpeValues } from '../../engine';

interface Props {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  label?: string;
  /** Smaller buttons for the log screen. */
  compact?: boolean;
  /** When set, buttons more than a point from this goal are dimmed instead of the fixed 7–9 band. */
  targetRpe?: number;
}

const VALUES = rpeValues();

/** Segmented control for RPE 6.5–10 in half steps. Tap the selected value again to clear it. */
export function RpePicker({ value, onChange, label = 'RPE', compact, targetRpe }: Props) {
  const outside = (v: number) => (targetRpe == null ? isOutsideWorkingRange(v) : Math.abs(v - targetRpe) > 1);
  return (
    <div class={`rpe ${compact ? 'rpe-compact' : ''}`} role="radiogroup" aria-label={label}>
      {VALUES.map((v) => {
        const selected = value === v;
        return (
          <button
            type="button"
            key={v}
            role="radio"
            aria-checked={selected}
            class={`rpe-btn ${selected ? 'selected' : ''} ${outside(v) ? 'outside' : ''}`}
            onClick={() => onChange(selected ? undefined : v)}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}
