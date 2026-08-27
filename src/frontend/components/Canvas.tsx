"use client";

import { Fragment, useRef, useState } from "react";

const STEP = 10;
const MIN = 25;
const MAX = 400;

const TOOLS = [
  { id: "move", label: "Move Tool", d: "M168,132.69,214.08,115l.33-.13A16,16,0,0,0,213,85.07L52.92,32.8A15.95,15.95,0,0,0,32.8,52.92L85.07,213a15.82,15.82,0,0,0,14.41,11l.78,0a15.84,15.84,0,0,0,14.61-9.59l.13-.33L132.69,168,184,219.31a16,16,0,0,0,22.63,0l12.68-12.68a16,16,0,0,0,0-22.63ZM195.31,208,144,156.69a16,16,0,0,0-26,4.93c0,.11-.09.22-.13.32l-17.65,46L48,48l159.85,52.2-45.95,17.64-.32.13a16,16,0,0,0-4.93,26h0L208,195.31Z" },
  { id: "box", label: "Bounding box Tool", d: "M208,96a16,16,0,0,0,16-16V48a16,16,0,0,0-16-16H176a16,16,0,0,0-16,16v8H96V48A16,16,0,0,0,80,32H48A16,16,0,0,0,32,48V80A16,16,0,0,0,48,96h8v64H48a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16H80a16,16,0,0,0,16-16v-8h64v8a16,16,0,0,0,16,16h32a16,16,0,0,0,16-16V176a16,16,0,0,0-16-16h-8V96ZM176,48h32V80H176ZM48,48H80V63.9a.51.51,0,0,0,0,.2V80H48ZM80,208H48V176H80v15.9a.51.51,0,0,0,0,.2V208Zm128,0H176V176h32Zm-24-48h-8a16,16,0,0,0-16,16v8H96v-8a16,16,0,0,0-16-16H72V96h8A16,16,0,0,0,96,80V72h64v8a16,16,0,0,0,16,16h8Z" },
  { id: "polygon", label: "Polygon Tool", d: "M230.64,49.36a32,32,0,0,0-45.26,0h0a31.9,31.9,0,0,0-5.16,6.76L152,48.42A32,32,0,0,0,97.37,25.36h0a32.06,32.06,0,0,0-5.76,37.41L57.67,93.32a32.05,32.05,0,0,0-40.31,4.05h0a32,32,0,0,0,42.89,47.41l70,51.36a32,32,0,1,0,47.57-14.69l27.39-77.59q1.38.12,2.76.12a32,32,0,0,0,22.63-54.62Zm-122-12.69h0a16,16,0,1,1,0,22.64A16,16,0,0,1,108.68,36.67Zm-80,94.65a16,16,0,0,1,0-22.64h0a16,16,0,1,1,0,22.64Zm142.65,88a16,16,0,0,1-22.63-22.63h0a16,16,0,1,1,22.63,22.63Zm-8.55-43.18a32,32,0,0,0-23,7.08l-70-51.36a32.17,32.17,0,0,0-1.34-26.65l33.95-30.55a32,32,0,0,0,45.47-10.81L176,71.56a32,32,0,0,0,14.12,27Zm56.56-92.84A16,16,0,1,1,196.7,60.68h0a16,16,0,0,1,22.63,22.63Z" },
  { id: "landmarks", label: "Landmarks Tool", d: "M72,60A12,12,0,1,1,60,48,12,12,0,0,1,72,60Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,128,48Zm68,24a12,12,0,1,0-12-12A12,12,0,0,0,196,72ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Zm68,0a12,12,0,1,0,12,12A12,12,0,0,0,128,116Zm68,0a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,184a12,12,0,1,0,12,12A12,12,0,0,0,60,184Zm68,0a12,12,0,1,0,12,12A12,12,0,0,0,128,184Zm68,0a12,12,0,1,0,12,12A12,12,0,0,0,196,184Z" },
  { id: "assist", label: "Label Assist", d: "M48,64a8,8,0,0,1,8-8H72V40a8,8,0,0,1,16,0V56h16a8,8,0,0,1,0,16H88V88a8,8,0,0,1-16,0V72H56A8,8,0,0,1,48,64ZM184,192h-8v-8a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0v-8h8a8,8,0,0,0,0-16Zm56-48H224V128a8,8,0,0,0-16,0v16H192a8,8,0,0,0,0,16h16v16a8,8,0,0,0,16,0V160h16a8,8,0,0,0,0-16ZM219.31,80,80,219.31a16,16,0,0,1-22.62,0L36.68,198.63a16,16,0,0,1,0-22.63L176,36.69a16,16,0,0,1,22.63,0l20.68,20.68A16,16,0,0,1,219.31,80Zm-54.63,32L144,91.31l-96,96L68.68,208ZM208,68.69,187.31,48l-32,32L176,100.69Z" },
] as const;

export default function Canvas() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(100);
  const [locked, setLocked] = useState(false);
  const [tool, setTool] = useState<(typeof TOOLS)[number]["id"]>("landmarks");
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
          <i /><i /><i /><i />
          <img src="/default.jpg" alt="" draggable={false} />
        </div>
      </div>
    </main>
    <div className="stack">
    <div className="panel tools">
      {TOOLS.map((t) => (
        <Fragment key={t.id}>
        {t.id === "assist" && <hr />}
        <button
          type="button"
          aria-label={t.label}
          aria-pressed={tool === t.id}
          onClick={() => setTool(t.id)}
        >
          <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
            <path d={t.d} fill="currentColor" />
          </svg>
        </button>
        </Fragment>
      ))}
    </div>
    <div className="panel zoom">
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
    </div>
    </>
  );
}
