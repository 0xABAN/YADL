"use client";

import { useEffect, useRef, useState } from "react";

export default function Synthetic({
  open,
  pos,
  onClose,
}: {
  open: boolean;
  pos: { x: number; y: number } | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      const panel = ref.current?.getBoundingClientRect();
      const btn = document.querySelector("[data-tip=synthetic-tool]")?.getBoundingClientRect();
      if (!panel) return;
      const pad = 40;
      let left = panel.left,
        right = panel.right,
        top = panel.top,
        bottom = panel.bottom;
      if (btn) {
        left = Math.min(left, btn.left);
        right = Math.max(right, btn.right);
        top = Math.min(top, btn.top);
        bottom = Math.max(bottom, btn.bottom);
      }
      if (e.clientX < left - pad || e.clientX > right + pad || e.clientY < top - pad || e.clientY > bottom + pad)
        onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !pos) return null;

  return (
    <div
      className="hist comments side synth"
      data-synth
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Synthetic images"
    >
      <header>
        <h2>Synthetic images</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="cmt-compose synth-body">
        <label className="sr-only" htmlFor="synth-prompt">
          Prompt
        </label>
        <textarea
          id="synth-prompt"
          ref={inputRef}
          className="synth-prompt"
          rows={4}
          spellCheck={false}
          placeholder="Describe the image to generate…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              setNote("Image generation isn’t wired yet.");
            }
          }}
        />
        <button
          type="button"
          className="synth-go"
          disabled={!prompt.trim()}
          onClick={() => setNote("Image generation isn’t wired yet.")}
        >
          Generate
        </button>
        {note && <p className="synth-note">{note}</p>}
      </div>
    </div>
  );
}
