"use client";

import { useRef, useState } from "react";

const STEP = 10;
const MIN = 25;
const MAX = 400;

export default function Canvas() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(100);
  const [locked, setLocked] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  return (
    <>
    <main
      onPointerDown={(e) => {
        if (locked) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: pos.x, y: pos.y, px: e.clientX, py: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setPos({
          x: drag.current.x + e.clientX - drag.current.px,
          y: drag.current.y + e.clientY - drag.current.py,
        });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <div
        className="world"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom / 100})` }}
      >
        <div className="dots" aria-hidden="true" />
        <div className="frame">
          <img src="/default.jpg" alt="" draggable={false} />
        </div>
      </div>
    </main>
    <div className="zoom">
        <button
          type="button"
          className="step"
          disabled={locked || zoom <= MIN}
          onClick={() => setZoom((z) => Math.max(MIN, z - STEP))}
          aria-label="Zoom out"
        >
          −
        </button>
        <span>{zoom}%</span>
        <button
          type="button"
          className="step"
          disabled={locked || zoom >= MAX}
          onClick={() => setZoom((z) => Math.min(MAX, z + STEP))}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Lock canvas"
          aria-pressed={locked}
          onClick={() => setLocked((v) => !v)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="3" y="7" width="10" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d={locked ? "M5 7V5a3 3 0 0 1 6 0v2" : "M5 7V5a3 3 0 0 1 6 0"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            setZoom(100);
            setPos({ x: 0, y: 0 });
          }}
        >
          RESET
        </button>
      </div>
    </>
  );
}
