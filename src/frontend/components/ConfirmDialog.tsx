"use client";

import { useEffect, useRef } from "react";

/** Centered in-app confirm (no browser "localhost says…"). */
export default function ConfirmDialog({
  open,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={message}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm-msg">{message}</p>
        <div className="confirm-actions">
          <button type="button" ref={cancelRef} className="confirm-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-ok" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
