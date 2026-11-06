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
  /** Replace the default number parsing (e.g. to accept "<6"). */
  parse?: (s: string) => number | undefined;
  /** Snap a parsed value (e.g. to half steps) before it is committed. */
  normalize?: (n: number) => number;
  /** How the committed value reads when the field isn't focused (e.g. 5 → "<6"). */
  format?: (n: number) => string;
}

/** Text input with the iOS numeric keypad. Keeps partial entries ("22.") while typing. */
export function NumberField({ value, onChange, mode = 'decimal', placeholder, class: cls, label, min, disabled, id, onEnter, enterKeyHint = 'done', onFocus, parse: customParse, normalize, format }: Props) {
  const show = (v: number | undefined) => (v == null ? '' : format ? format(v) : String(v));
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const parsed = parse(text);
    if (parsed !== value) setText(focused && value != null ? String(value) : show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function parse(s: string): number | undefined {
    const t = s.trim();
    if (t === '' || t === '.' || t === '-') return undefined;
    let n: number | undefined;
    if (customParse) n = customParse(t);
    else {
      n = mode === 'numeric' ? parseInt(t, 10) : parseFloat(t);
      if (!Number.isFinite(n)) return undefined;
    }
    if (n == null) return undefined;
    if (min != null && n < min) n = min;
    return normalize ? normalize(n) : n;
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
      onBlur={() => { setFocused(false); setText(show(value)); }}
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); onFocus?.(); }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || !onEnter) return;
        e.preventDefault();
        onEnter();
      }}
    />
  );
}
