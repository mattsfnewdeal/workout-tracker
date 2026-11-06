import { useEffect, useState } from 'preact/hooks';

interface Props {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  /** 'decimal' shows a keypad with a decimal point; 'numeric' is whole numbers only. */
  mode?: 'decimal' | 'numeric';
  placeholder?: string;
  class?: string;
  label?: string;
  min?: number;
  disabled?: boolean;
  id?: string;
  /** Enter (or the keyboard's Next/Done key) calls this after the value is committed. */
  onEnter?: () => void;
  enterKeyHint?: 'next' | 'done';
  onFocus?: () => void;
}

/** Text input with the iOS numeric keypad. Keeps partial entries ("22.") while typing. */
export function NumberField({ value, onChange, mode = 'decimal', placeholder, class: cls, label, min, disabled, id, onEnter, enterKeyHint = 'done', onFocus }: Props) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    const parsed = parse(text);
    if (parsed !== value) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function parse(s: string): number | undefined {
    const t = s.trim();
    if (t === '' || t === '.' || t === '-') return undefined;
    const n = mode === 'numeric' ? parseInt(t, 10) : parseFloat(t);
    if (!Number.isFinite(n)) return undefined;
    if (min != null && n < min) return min;
    return n;
  }

  return (
    <input
      id={id}
      type="text"
      inputMode={mode}
      pattern={mode === 'numeric' ? '[0-9]*' : undefined}
      autocomplete="off"
      enterKeyHint={enterKeyHint}
      class={`num ${cls ?? ''}`}
      placeholder={placeholder}
      aria-label={label}
      disabled={disabled}
      value={text}
      onInput={(e) => {
        const s = e.currentTarget.value;
        setText(s);
        onChange(parse(s));
      }}
      onBlur={() => setText(value == null ? '' : String(value))}
      onFocus={(e) => { e.currentTarget.select(); onFocus?.(); }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || !onEnter) return;
        e.preventDefault();
        onEnter();
      }}
    />
  );
}
