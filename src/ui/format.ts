import type { RepTarget, Suggestion } from '../engine';

export function fmtLoad(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/** A load as the lifter reads it: "225", or for a bodyweight exercise "BW" / "BW +25". */
export function fmtLoadBw(load: number, bodyweight?: boolean): string {
  if (!bodyweight) return fmtLoad(load);
  return load > 0 ? `BW +${fmtLoad(load)}` : 'BW';
}

export function fmtRpe(r: number | null | undefined): string {
  return r == null ? '—' : String(r);
}

export function fmtRepTarget(t: RepTarget): string {
  if (t.kind === 'fixed') return String(t.reps);
  return `${t.min}–${t.max}`;
}

/** "225 × 5 @ 8" / "185 × 6–8 @ 8", or "5 reps @ 8" / "6–8 reps @ 8" on a first session (no load yet). */
export function fmtSuggestion(s: Suggestion, bodyweight?: boolean): string {
  const reps = fmtRepTarget(s.repTarget);
  return s.load == null ? `${reps} reps @ ${s.targetRpe}` : `${fmtLoadBw(s.load, bodyweight)} × ${reps} @ ${s.targetRpe}`;
}

export function fmtDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function fmtDateTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtAgo(ts: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
