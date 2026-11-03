import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

interface Props {
  open: boolean;
  title: string;
  children?: ComponentChildren;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'OK', cancelLabel = 'Cancel', danger, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div class="overlay" onClick={onCancel}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-title">{title}</h2>
        <div class="dialog-body">{children}</div>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" class={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
