import { isOutsideWorkingRange, rpeValues } from '../../engine';

interface Props {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  label?: string;
  /** Smaller buttons for the log screen. */
  compact?: boolean;
}

const VALUES = rpeValues();

/** Segmented control for RPE 6.5–10 in half steps. Tap the selected value again to clear it. */
export function RpePicker({ value, onChange, label = 'RPE', compact }: Props) {
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
            class={`rpe-btn ${selected ? 'selected' : ''} ${isOutsideWorkingRange(v) ? 'outside' : ''}`}
            onClick={() => onChange(selected ? undefined : v)}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}
