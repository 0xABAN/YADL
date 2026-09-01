"use client";

import { useEffect, useRef } from "react";
import type { Doc } from "../geometry/doc";

function relTime(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.round((t - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(sec, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86400), "day");
}

export default function HistoryPanel({
  open,
  pos,
  history,
  onClose,
  onRestore,
}: {
  open: boolean;
  pos: { x: number; y: number } | null;
  history: NonNullable<Doc["history"]>;
  onClose: () => void;
  onRestore: (objects: NonNullable<Doc["history"]>[number]["objects"]) => void;
}) {
  const histRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      const panel = histRef.current?.getBoundingClientRect();
      const btn = document.querySelector("[data-tip=history]")?.getBoundingClientRect();
      if (!panel || !btn) return;
      const pad = 40;
      const left = Math.min(panel.left, btn.left) - pad;
      const right = Math.max(panel.right, btn.right) + pad;
      const top = Math.min(panel.top, btn.top) - pad;
      const bottom = Math.max(panel.bottom, btn.bottom) + pad;
      if (e.clientX < left || e.clientX > right || e.clientY < top || e.clientY > bottom) onClose();
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [open, onClose]);

  if (!open || !pos) return null;

  return (
    <div
      className="hist"
      data-hist
      ref={histRef}
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="History"
    >
      <header>
        <h2>History</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {history.length === 0 ? (
        <p className="empty">No versions</p>
      ) : (
        <ul>
          {[...history].reverse().map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => {
                  if (!confirm("Restore this version? Current unsaved geometry will be replaced.")) return;
                  onRestore(v.objects ?? []);
                  onClose();
                }}
              >
                <span className="hist-id">{v.id}</span>
                {v.at && <time dateTime={v.at}>{relTime(v.at)}</time>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
