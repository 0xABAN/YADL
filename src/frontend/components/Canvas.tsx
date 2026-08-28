"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE } from "react";
import { CONNECTIONS, PRESETS, REGION_COLOR, pose, region, type Landmark } from "@/lib/hand";

const OPEN = pose(PRESETS.open);
const STEP = 10;
const MIN = 25;
const MAX = 400;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Box = { x: number; y: number; w: number; h: number };
type Gest =
  | { t: "draw"; x0: number; y0: number }
  | { t: "resize"; i: number; ax: number | null; ay: number | null; start: Box }
  | { t: "move"; i: number; x0: number; y0: number; start: Box };

const HANDLES: { c: string; ax: (b: Box) => number | null; ay: (b: Box) => number | null }[] = [
  { c: "nw", ax: (b) => b.x + b.w, ay: (b) => b.y + b.h },
  { c: "n", ax: () => null, ay: (b) => b.y + b.h },
  { c: "ne", ax: (b) => b.x, ay: (b) => b.y + b.h },
  { c: "e", ax: (b) => b.x, ay: () => null },
  { c: "se", ax: (b) => b.x, ay: (b) => b.y },
  { c: "s", ax: () => null, ay: (b) => b.y },
  { c: "sw", ax: (b) => b.x + b.w, ay: (b) => b.y },
  { c: "w", ax: (b) => b.x + b.w, ay: () => null },
];

const boxFrom = (x0: number, y0: number, x1: number, y1: number): Box => {
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
};
const shiftBox = (b: Box, dx: number, dy: number): Box => ({
  ...b,
  x: Math.min(Math.max(0, b.x + dx), 1 - b.w),
  y: Math.min(Math.max(0, b.y + dy), 1 - b.h),
});
const eqBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const tiny = (b: Box, r: DOMRect) => b.w * r.width < 4 && b.h * r.height < 4;
const resizeBox = (g: Extract<Gest, { t: "resize" }>, p: { x: number; y: number }) =>
  boxFrom(
    g.ax ?? g.start.x,
    g.ay ?? g.start.y,
    g.ax != null ? p.x : g.start.x + g.start.w,
    g.ay != null ? p.y : g.start.y + g.start.h,
  );
const boxStyle = (b: Box): CSSProperties => ({
  left: `${b.x * 100}%`,
  top: `${b.y * 100}%`,
  width: `${b.w * 100}%`,
  height: `${b.h * 100}%`,
});

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
  const [hand, setHand] = useState<Landmark[]>(OPEN);
  const [hold, setHold] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [draft, setDraft] = useState<Box | null>(null);
  const [boxHold, setBoxHold] = useState<number | "draw" | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const live = useRef(hand);
  const sel = useRef<number | null>(null);
  const dragPt = useRef<{ i: number; start: Landmark[] } | null>(null);
  const frameR = useRef<DOMRect | null>(null);
  const undo = useRef<Landmark[][]>([]);
  const redo = useRef<Landmark[][]>([]);
  const liveBoxes = useRef(boxes);
  const gest = useRef<Gest | null>(null);
  const snap = useRef<Box[]>([]);
  const draftRef = useRef<Box | null>(null);
  const boxUndo = useRef<Box[][]>([]);
  const boxRedo = useRef<Box[][]>([]);
  live.current = hand;
  liveBoxes.current = boxes;

  const apply = (next: Landmark[]) => {
    live.current = next;
    setHand(next);
  };
  const applyBoxes = (next: Box[]) => {
    liveBoxes.current = next;
    setBoxes(next);
  };
  const pushUndo = (prev: Landmark[]) => {
    undo.current.push(prev);
    if (undo.current.length > 50) undo.current.shift();
    redo.current = [];
  };
  const pushBoxUndo = (prev: Box[]) => {
    boxUndo.current.push(prev);
    if (boxUndo.current.length > 50) boxUndo.current.shift();
    boxRedo.current = [];
  };
  const abortBox = () => {
    if (gest.current && gest.current.t !== "draw") applyBoxes(snap.current);
    gest.current = null;
    frameR.current = null;
    draftRef.current = null;
    setDraft(null);
    setBoxHold(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape" && gest.current) {
        e.preventDefault();
        abortBox();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (gest.current) {
          abortBox();
          return;
        }
        if (tool === "box") {
          if (e.shiftKey) {
            const n = boxRedo.current.pop();
            if (!n) return;
            boxUndo.current.push(liveBoxes.current);
            applyBoxes(n);
          } else {
            const n = boxUndo.current.pop();
            if (!n) return;
            boxRedo.current.push(liveBoxes.current);
            applyBoxes(n);
          }
          return;
        }
        if (e.shiftKey) {
          const n = redo.current.pop();
          if (!n) return;
          undo.current.push(live.current);
          apply(n);
        } else {
          const n = undo.current.pop();
          if (!n) return;
          redo.current.push(live.current);
          apply(n);
        }
        return;
      }
      if (tool !== "landmarks" || locked || sel.current == null || !e.key.startsWith("Arrow")) return;
      e.preventDefault();
      const r = frame.current?.getBoundingClientRect();
      const dx = (e.shiftKey ? 10 : 1) / (r?.width || 500);
      const dy = (e.shiftKey ? 10 : 1) / (r?.height || 500);
      const i = sel.current;
      const p = live.current[i];
      const x = clamp01(p.x + (e.key === "ArrowRight" ? dx : e.key === "ArrowLeft" ? -dx : 0));
      const y = clamp01(p.y + (e.key === "ArrowDown" ? dy : e.key === "ArrowUp" ? -dy : 0));
      if (x === p.x && y === p.y) return;
      pushUndo(live.current);
      apply(live.current.map((q, j) => (j === i ? { ...q, x, y } : q)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, tool]);

  useEffect(() => {
    if (hold == null) return;
    const move = (e: PointerEvent) => {
      const d = dragPt.current;
      const r = frameR.current;
      if (!d || !r) return;
      const x = clamp01((e.clientX - r.left) / r.width);
      const y = clamp01((e.clientY - r.top) / r.height);
      apply(live.current.map((p, j) => (j === d.i ? { ...p, x, y } : p)));
    };
    const up = () => {
      const d = dragPt.current;
      dragPt.current = null;
      frameR.current = null;
      setHold(null);
      if (!d) return;
      const p = live.current[d.i];
      if (p.x === d.start[d.i].x && p.y === d.start[d.i].y) return;
      pushUndo(d.start);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [hold]);

  useEffect(() => {
    if (tool === "box" && !locked) return;
    if (gest.current) abortBox();
  }, [tool, locked]);

  useEffect(() => {
    if (boxHold == null) return;
    const at = (e: PointerEvent) => {
      const r = frameR.current!;
      return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
    };
    const move = (e: PointerEvent) => {
      const g = gest.current;
      if (!g) return;
      const p = at(e);
      if (g.t === "draw") {
        const b = boxFrom(g.x0, g.y0, p.x, p.y);
        draftRef.current = b;
        setDraft(b);
      } else if (g.t === "resize") {
        applyBoxes(liveBoxes.current.map((b, i) => (i === g.i ? resizeBox(g, p) : b)));
      } else {
        applyBoxes(liveBoxes.current.map((b, i) => (i === g.i ? shiftBox(g.start, p.x - g.x0, p.y - g.y0) : b)));
      }
    };
    const up = () => {
      const g = gest.current;
      const r = frameR.current;
      gest.current = null;
      frameR.current = null;
      setBoxHold(null);
      if (!g || !r) {
        draftRef.current = null;
        setDraft(null);
        return;
      }
      if (g.t === "draw") {
        const b = draftRef.current;
        draftRef.current = null;
        setDraft(null);
        if (!b || tiny(b, r)) return;
        pushBoxUndo(snap.current);
        applyBoxes([...snap.current, b]);
        return;
      }
      const b = liveBoxes.current[g.i];
      if (g.t === "resize" && tiny(b, r)) {
        applyBoxes(snap.current);
        return;
      }
      if (eqBox(b, snap.current[g.i])) return;
      pushBoxUndo(snap.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [boxHold]);

  const startBox = (e: PE<HTMLElement>, g: Gest) => {
    if (locked || tool !== "box") return;
    e.stopPropagation();
    const r = frame.current!.getBoundingClientRect();
    frameR.current = r;
    snap.current = liveBoxes.current;
    if (g.t === "move") {
      g.x0 = clamp01((e.clientX - r.left) / r.width);
      g.y0 = clamp01((e.clientY - r.top) / r.height);
    }
    gest.current = g;
    setBoxHold(g.t === "draw" ? "draw" : g.i);
  };

  return (
    <>
    <main
      className={tool === "box" && !locked ? "cross" : undefined}
      onPointerDown={(e) => {
        if (locked || hold != null || boxHold != null) return;
        if (tool === "box") {
          const r = frame.current!.getBoundingClientRect();
          frameR.current = r;
          const x = clamp01((e.clientX - r.left) / r.width);
          const y = clamp01((e.clientY - r.top) / r.height);
          snap.current = liveBoxes.current;
          gest.current = { t: "draw", x0: x, y0: y };
          const z = { x, y, w: 0, h: 0 };
          draftRef.current = z;
          setDraft(z);
          setBoxHold("draw");
          return;
        }
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
        <div className="frame" ref={frame}>
          <i /><i /><i /><i />
          <img src="/default.jpg" alt="" draggable={false} />
          <div className={`boxes${tool === "box" && !locked ? " edit" : ""}`}>
            {boxes.map((b, i) => (
              <div
                key={i}
                className={`box${boxHold === i ? " on" : ""}`}
                style={boxStyle(b)}
                onPointerDown={(e) => startBox(e, { t: "move", i, x0: 0, y0: 0, start: b })}
              >
                {HANDLES.map((h) => (
                  <span
                    key={h.c}
                    className={`h ${h.c}`}
                    onPointerDown={(e) => startBox(e, { t: "resize", i, ax: h.ax(b), ay: h.ay(b), start: b })}
                  />
                ))}
              </div>
            ))}
            {draft && <div className="box draft" style={boxStyle(draft)} />}
          </div>
          <div className={`hand${tool === "landmarks" && !locked ? " edit" : ""}`}>
            <svg viewBox="0 0 1 1" preserveAspectRatio="none">
              {CONNECTIONS.map(([a, b]) => (
                <line key={`${a}-${b}`} x1={hand[a].x} y1={hand[a].y} x2={hand[b].x} y2={hand[b].y} />
              ))}
            </svg>
            {hand.map((p, i) => (
              <span
                key={i}
                className={`pt${hold === i ? " on" : ""}`}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, "--c": REGION_COLOR[region(i)] } as CSSProperties}
                onPointerDown={(e) => {
                  if (locked || tool !== "landmarks") return;
                  e.stopPropagation();
                  frameR.current = frame.current!.getBoundingClientRect();
                  sel.current = i;
                  dragPt.current = { i, start: live.current };
                  setHold(i);
                }}
              >
                <span className="chip">{i} {region(i).toUpperCase()}</span>
                <span className="dot" />
              </span>
            ))}
          </div>
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
