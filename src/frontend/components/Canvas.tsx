"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE } from "react";
import { CONNECTIONS, HAND_COLOR } from "@/lib/hand";
import { SHOWN, type HandObj, type ToolId } from "@/lib/doc";
const STEP = 10;
const MIN = 25;
const MAX = 400;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type Box = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
type Poly = { pts: Pt[] };
type Gest =
  | { t: "draw"; x0: number; y0: number }
  | { t: "resize"; i: number; ax: number | null; ay: number | null; start: Box }
  | { t: "move"; i: number; x0: number; y0: number; start: Box };
type PolyGest =
  | { t: "draw" }
  | { t: "vertex"; i: number; j: number }
  | { t: "move"; i: number; x0: number; y0: number; start: Poly };

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
const ptsStr = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
const eqPoly = (a: Poly, b: Poly) =>
  a.pts.length === b.pts.length && a.pts.every((p, i) => p.x === b.pts[i].x && p.y === b.pts[i].y);
const tinyPoly = (pts: Pt[], r: DOMRect) => {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return tiny({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, r);
};
const shiftPoly = (p: Poly, dx: number, dy: number): Poly => {
  let loX = -Infinity, hiX = Infinity, loY = -Infinity, hiY = Infinity;
  for (const q of p.pts) {
    loX = Math.max(loX, -q.x);
    hiX = Math.min(hiX, 1 - q.x);
    loY = Math.max(loY, -q.y);
    hiY = Math.min(hiY, 1 - q.y);
  }
  const x = Math.min(Math.max(dx, loX), hiX);
  const y = Math.min(Math.max(dy, loY), hiY);
  return { pts: p.pts.map((q) => ({ x: q.x + x, y: q.y + y })) };
};
const nearPx = (a: Pt, b: Pt, r: DOMRect, px: number) => {
  const dx = (a.x - b.x) * r.width, dy = (a.y - b.y) * r.height;
  return dx * dx + dy * dy < px * px;
};
const onSeg = (a: Pt, b: Pt, p: Pt): Pt => {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2));
  return { x: a.x + abx * t, y: a.y + aby * t };
};
const atRect = (e: { clientX: number; clientY: number }, r: DOMRect): Pt => ({
  x: clamp01((e.clientX - r.left) / r.width),
  y: clamp01((e.clientY - r.top) / r.height),
});

const TOOLS = [
  { id: "move", label: "Move Tool", d: "M168,132.69,214.08,115l.33-.13A16,16,0,0,0,213,85.07L52.92,32.8A15.95,15.95,0,0,0,32.8,52.92L85.07,213a15.82,15.82,0,0,0,14.41,11l.78,0a15.84,15.84,0,0,0,14.61-9.59l.13-.33L132.69,168,184,219.31a16,16,0,0,0,22.63,0l12.68-12.68a16,16,0,0,0,0-22.63ZM195.31,208,144,156.69a16,16,0,0,0-26,4.93c0,.11-.09.22-.13.32l-17.65,46L48,48l159.85,52.2-45.95,17.64-.32.13a16,16,0,0,0-4.93,26h0L208,195.31Z" },
  { id: "box", label: "Bounding box Tool", d: "M208,96a16,16,0,0,0,16-16V48a16,16,0,0,0-16-16H176a16,16,0,0,0-16,16v8H96V48A16,16,0,0,0,80,32H48A16,16,0,0,0,32,48V80A16,16,0,0,0,48,96h8v64H48a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16H80a16,16,0,0,0,16-16v-8h64v8a16,16,0,0,0,16,16h32a16,16,0,0,0,16-16V176a16,16,0,0,0-16-16h-8V96ZM176,48h32V80H176ZM48,48H80V63.9a.51.51,0,0,0,0,.2V80H48ZM80,208H48V176H80v15.9a.51.51,0,0,0,0,.2V208Zm128,0H176V176h32Zm-24-48h-8a16,16,0,0,0-16,16v8H96v-8a16,16,0,0,0-16-16H72V96h8A16,16,0,0,0,96,80V72h64v8a16,16,0,0,0,16,16h8Z" },
  { id: "polygon", label: "Polygon Tool", d: "M230.64,49.36a32,32,0,0,0-45.26,0h0a31.9,31.9,0,0,0-5.16,6.76L152,48.42A32,32,0,0,0,97.37,25.36h0a32.06,32.06,0,0,0-5.76,37.41L57.67,93.32a32.05,32.05,0,0,0-40.31,4.05h0a32,32,0,0,0,42.89,47.41l70,51.36a32,32,0,1,0,47.57-14.69l27.39-77.59q1.38.12,2.76.12a32,32,0,0,0,22.63-54.62Zm-122-12.69h0a16,16,0,1,1,0,22.64A16,16,0,0,1,108.68,36.67Zm-80,94.65a16,16,0,0,1,0-22.64h0a16,16,0,1,1,0,22.64Zm142.65,88a16,16,0,0,1-22.63-22.63h0a16,16,0,1,1,22.63,22.63Zm-8.55-43.18a32,32,0,0,0-23,7.08l-70-51.36a32.17,32.17,0,0,0-1.34-26.65l33.95-30.55a32,32,0,0,0,45.47-10.81L176,71.56a32,32,0,0,0,14.12,27Zm56.56-92.84A16,16,0,1,1,196.7,60.68h0a16,16,0,0,1,22.63,22.63Z" },
  { id: "landmarks", label: "Landmarks Tool", d: "M72,60A12,12,0,1,1,60,48,12,12,0,0,1,72,60Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,128,48Zm68,24a12,12,0,1,0-12-12A12,12,0,0,0,196,72ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Zm68,0a12,12,0,1,0,12,12A12,12,0,0,0,128,116Zm68,0a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,184a12,12,0,1,0,12,12A12,12,0,0,0,60,184Zm68,0a12,12,0,1,0,12,12A12,12,0,0,0,128,184Zm68,0a12,12,0,1,0,12,12A12,12,0,0,0,196,184Z" },
  { id: "assist", label: "Label Assist", d: "M48,64a8,8,0,0,1,8-8H72V40a8,8,0,0,1,16,0V56h16a8,8,0,0,1,0,16H88V88a8,8,0,0,1-16,0V72H56A8,8,0,0,1,48,64ZM184,192h-8v-8a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0v-8h8a8,8,0,0,0,0-16Zm56-48H224V128a8,8,0,0,0-16,0v16H192a8,8,0,0,0,0,16h16v16a8,8,0,0,0,16,0V160h16a8,8,0,0,0,0-16ZM219.31,80,80,219.31a16,16,0,0,1-22.62,0L36.68,198.63a16,16,0,0,1,0-22.63L176,36.69a16,16,0,0,1,22.63,0l20.68,20.68A16,16,0,0,1,219.31,80Zm-54.63,32L144,91.31l-96,96L68.68,208ZM208,68.69,187.31,48l-32,32L176,100.69Z" },
] as const;

export default function Canvas({
  src = "/default.jpg",
  objects = [],
  onChange,
  onAssist,
  shown = SHOWN.hands,
}: {
  src?: string;
  objects?: HandObj[];
  onChange?: (objects: HandObj[]) => void;
  onAssist?: () => void;
  shown?: ToolId[];
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(100);
  const [locked, setLocked] = useState(false);
  const [tool, setTool] = useState<(typeof TOOLS)[number]["id"]>(
    shown.find((t) => t !== "assist") ?? "move",
  );
  const [hands, setHands] = useState<HandObj[]>(objects);
  const [hold, setHold] = useState<{ h: number; i: number } | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [draft, setDraft] = useState<Box | null>(null);
  const [boxHold, setBoxHold] = useState<number | "draw" | null>(null);
  const [polys, setPolys] = useState<Poly[]>([]);
  const [polyDraft, setPolyDraft] = useState<Pt[] | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [polyHold, setPolyHold] = useState<number | "draw" | null>(null);
  const [vertHold, setVertHold] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const live = useRef(hands);
  const sel = useRef<{ h: number; i: number } | null>(null);
  const dragPt = useRef<{ h: number; i: number; start: HandObj[] } | null>(null);
  const frameR = useRef<DOMRect | null>(null);
  const undo = useRef<HandObj[][]>([]);
  const redo = useRef<HandObj[][]>([]);
  const liveBoxes = useRef(boxes);
  const gest = useRef<Gest | null>(null);
  const snap = useRef<Box[]>([]);
  const draftRef = useRef<Box | null>(null);
  const boxUndo = useRef<Box[][]>([]);
  const boxRedo = useRef<Box[][]>([]);
  const livePolys = useRef(polys);
  const polyGest = useRef<PolyGest | null>(null);
  const polySnap = useRef<Poly[]>([]);
  const polyDraftRef = useRef<Pt[] | null>(null);
  const polyUndo = useRef<Poly[][]>([]);
  const polyRedo = useRef<Poly[][]>([]);
  const selVert = useRef<{ i: number; j: number } | null>(null);
  live.current = hands;
  liveBoxes.current = boxes;
  livePolys.current = polys;

  useEffect(() => {
    setHands(objects);
    live.current = objects;
  }, [objects]);
  useEffect(() => {
    undo.current = [];
    redo.current = [];
  }, [src]);

  const apply = (next: HandObj[]) => {
    live.current = next;
    setHands(next);
  };
  const applyBoxes = (next: Box[]) => {
    liveBoxes.current = next;
    setBoxes(next);
  };
  const applyPolys = (next: Poly[]) => {
    livePolys.current = next;
    setPolys(next);
  };
  const patchLm = (h: number, i: number, x: number, y: number) =>
    live.current.map((o, k) =>
      k !== h
        ? o
        : {
            ...o,
            edited: true,
            geom: { ...o.geom, landmarks: o.geom.landmarks.map((q, j) => (j === i ? { ...q, x, y } : q)) },
          },
    );
  const pushUndo = (prev: HandObj[]) => {
    undo.current.push(prev);
    if (undo.current.length > 50) undo.current.shift();
    redo.current = [];
  };
  const pushBoxUndo = (prev: Box[]) => {
    boxUndo.current.push(prev);
    if (boxUndo.current.length > 50) boxUndo.current.shift();
    boxRedo.current = [];
  };
  const pushPolyUndo = (prev: Poly[]) => {
    polyUndo.current.push(prev);
    if (polyUndo.current.length > 50) polyUndo.current.shift();
    polyRedo.current = [];
  };
  const abortBox = () => {
    if (gest.current && gest.current.t !== "draw") applyBoxes(snap.current);
    gest.current = null;
    frameR.current = null;
    draftRef.current = null;
    setDraft(null);
    setBoxHold(null);
  };
  const abortPoly = () => {
    if (polyGest.current && polyGest.current.t !== "draw") applyPolys(polySnap.current);
    polyGest.current = null;
    polyDraftRef.current = null;
    frameR.current = null;
    setPolyDraft(null);
    setCursor(null);
    setPolyHold(null);
    setVertHold(null);
  };
  const closePoly = () => {
    const d = polyDraftRef.current;
    const r = frame.current?.getBoundingClientRect();
    polyGest.current = null;
    polyDraftRef.current = null;
    setPolyDraft(null);
    setCursor(null);
    setPolyHold(null);
    setVertHold(null);
    if (!d || d.length < 3 || !r || tinyPoly(d, r)) return;
    pushPolyUndo(livePolys.current);
    applyPolys([...livePolys.current, { pts: d }]);
  };
  const popDraft = () => {
    const d = polyDraftRef.current;
    if (!d) return;
    if (d.length <= 1) {
      abortPoly();
      return;
    }
    const n = d.slice(0, -1);
    polyDraftRef.current = n;
    setPolyDraft(n);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        if (gest.current) {
          e.preventDefault();
          abortBox();
        } else if (polyGest.current || polyDraftRef.current) {
          e.preventDefault();
          abortPoly();
        }
        return;
      }
      if (tool === "polygon" && (e.key === "Enter" || e.key === "Backspace" || e.key === "Delete")) {
        if (e.key === "Enter") {
          if (polyDraftRef.current && polyDraftRef.current.length >= 3) {
            e.preventDefault();
            closePoly();
          }
          return;
        }
        e.preventDefault();
        if (polyDraftRef.current) {
          popDraft();
          return;
        }
        const s = selVert.current;
        if (!s || locked) return;
        const p = livePolys.current[s.i];
        if (!p || p.pts.length <= 3) return;
        pushPolyUndo(livePolys.current);
        applyPolys(livePolys.current.map((q, k) => (k !== s.i ? q : { pts: q.pts.filter((_, j) => j !== s.j) })));
        selVert.current = null;
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (tool === "polygon") {
          if (polyDraftRef.current) {
            popDraft();
            return;
          }
          if (polyGest.current) {
            abortPoly();
            return;
          }
          if (e.shiftKey) {
            const n = polyRedo.current.pop();
            if (!n) return;
            polyUndo.current.push(livePolys.current);
            applyPolys(n);
          } else {
            const n = polyUndo.current.pop();
            if (!n) return;
            polyRedo.current.push(livePolys.current);
            applyPolys(n);
          }
          return;
        }
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
          change.current?.(n);
        } else {
          const n = undo.current.pop();
          if (!n) return;
          redo.current.push(live.current);
          apply(n);
          change.current?.(n);
        }
        return;
      }
      if (tool !== "landmarks" || locked || sel.current == null || !e.key.startsWith("Arrow")) return;
      e.preventDefault();
      const r = frame.current?.getBoundingClientRect();
      const dx = (e.shiftKey ? 10 : 1) / (r?.width || 500);
      const dy = (e.shiftKey ? 10 : 1) / (r?.height || 500);
      const s = sel.current;
      const obj = live.current[s.h];
      if (!obj || obj.geom.t !== "hand") return;
      const p = obj.geom.landmarks[s.i];
      const x = clamp01(p.x + (e.key === "ArrowRight" ? dx : e.key === "ArrowLeft" ? -dx : 0));
      const y = clamp01(p.y + (e.key === "ArrowDown" ? dy : e.key === "ArrowUp" ? -dy : 0));
      if (x === p.x && y === p.y) return;
      pushUndo(live.current);
      const next = patchLm(s.h, s.i, x, y);
      apply(next);
      change.current?.(next);
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
      const p = atRect(e, r);
      apply(patchLm(d.h, d.i, p.x, p.y));
    };
    const up = () => {
      const d = dragPt.current;
      dragPt.current = null;
      frameR.current = null;
      setHold(null);
      if (!d) return;
      const now = live.current[d.h]?.geom.landmarks[d.i];
      const was = d.start[d.h]?.geom.landmarks[d.i];
      if (!now || !was || (now.x === was.x && now.y === was.y)) return;
      pushUndo(d.start);
      change.current?.(live.current);
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
    if (tool === "polygon" && !locked) return;
    if (polyGest.current || polyDraftRef.current) abortPoly();
  }, [tool, locked]);

  useEffect(() => {
    if (boxHold == null) return;
    const move = (e: PointerEvent) => {
      const g = gest.current;
      const r = frameR.current;
      if (!g || !r) return;
      const p = atRect(e, r);
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

  useEffect(() => {
    if (polyHold !== "draw") return;
    const move = (e: PointerEvent) => {
      const el = frame.current;
      if (!el) return;
      setCursor(atRect(e, el.getBoundingClientRect()));
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [polyHold]);

  useEffect(() => {
    if (polyHold == null || polyHold === "draw") return;
    const move = (e: PointerEvent) => {
      const g = polyGest.current;
      const r = frameR.current;
      if (!g || g.t === "draw" || !r) return;
      const p = atRect(e, r);
      if (g.t === "vertex") {
        applyPolys(livePolys.current.map((q, i) => (i !== g.i ? q : { pts: q.pts.map((pt, j) => (j === g.j ? p : pt)) })));
      } else {
        applyPolys(livePolys.current.map((q, i) => (i !== g.i ? q : shiftPoly(g.start, p.x - g.x0, p.y - g.y0))));
      }
    };
    const up = () => {
      const g = polyGest.current;
      const r = frameR.current;
      polyGest.current = null;
      frameR.current = null;
      setPolyHold(null);
      setVertHold(null);
      if (!g || g.t === "draw" || !r) return;
      const p = livePolys.current[g.i];
      if (tinyPoly(p.pts, r)) {
        applyPolys(polySnap.current);
        return;
      }
      if (eqPoly(p, polySnap.current[g.i])) return;
      pushPolyUndo(polySnap.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [polyHold]);

  const startBox = (e: PE<HTMLElement>, g: Gest) => {
    if (locked || tool !== "box") return;
    e.stopPropagation();
    const r = frame.current!.getBoundingClientRect();
    frameR.current = r;
    snap.current = liveBoxes.current;
    if (g.t === "move") {
      const p = atRect(e, r);
      g.x0 = p.x;
      g.y0 = p.y;
    }
    gest.current = g;
    setBoxHold(g.t === "draw" ? "draw" : g.i);
  };

  const startPoly = (e: PE<Element>, g: Exclude<PolyGest, { t: "draw" }>) => {
    if (locked || tool !== "polygon" || polyDraftRef.current) return;
    e.stopPropagation();
    const r = frame.current!.getBoundingClientRect();
    frameR.current = r;
    polySnap.current = livePolys.current;
    if (g.t === "move") {
      const p = atRect(e, r);
      g.x0 = p.x;
      g.y0 = p.y;
    }
    if (g.t === "vertex") {
      selVert.current = { i: g.i, j: g.j };
      setVertHold(g.j);
    }
    polyGest.current = g;
    setPolyHold(g.i);
  };

  const plant = (e: PE<HTMLElement>) => {
    const r = frame.current!.getBoundingClientRect();
    const p = atRect(e, r);
    const d = polyDraftRef.current;
    if (!d) {
      polyDraftRef.current = [p];
      polyGest.current = { t: "draw" };
      setPolyDraft([p]);
      setCursor(p);
      setPolyHold("draw");
      return;
    }
    if (d.length >= 3 && nearPx(p, d[0], r, 12)) {
      closePoly();
      return;
    }
    if (nearPx(p, d[d.length - 1], r, 4)) return;
    const n = [...d, p];
    polyDraftRef.current = n;
    setPolyDraft(n);
  };

  const polyEdit = tool === "polygon" && !locked;
  const drawing = polyHold === "draw";

  return (
    <>
    <main
      className={!locked && (tool === "box" || tool === "polygon") ? "cross" : undefined}
      onPointerDown={(e) => {
        if (locked || hold != null || boxHold != null) return;
        if (typeof polyHold === "number") return;
        if (tool === "box") {
          const r = frame.current!.getBoundingClientRect();
          frameR.current = r;
          const { x, y } = atRect(e, r);
          snap.current = liveBoxes.current;
          gest.current = { t: "draw", x0: x, y0: y };
          const z = { x, y, w: 0, h: 0 };
          draftRef.current = z;
          setDraft(z);
          setBoxHold("draw");
          return;
        }
        if (tool === "polygon") {
          plant(e);
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: pos.x, y: pos.y, px: e.clientX, py: e.clientY };
      }}
      onDoubleClick={(e) => {
        if (tool !== "polygon" || locked) return;
        e.preventDefault();
        if (polyDraftRef.current && polyDraftRef.current.length >= 3) closePoly();
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
          <img src={src} alt="" draggable={false} />
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
          <div className={`polys${polyEdit ? " edit" : ""}`}>
            <svg viewBox="0 0 1 1" preserveAspectRatio="none">
              {polys.map((p, i) => (
                <g key={i}>
                  <polygon
                    className={`poly${polyHold === i ? " on" : ""}`}
                    points={ptsStr(p.pts)}
                    onPointerDown={(e) => startPoly(e, { t: "move", i, x0: 0, y0: 0, start: p })}
                  />
                  {polyEdit && !drawing && p.pts.map((a, j) => {
                    const b = p.pts[(j + 1) % p.pts.length];
                    return (
                      <line
                        key={j}
                        className="edge"
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        onPointerDown={(e) => {
                          if (locked || tool !== "polygon") return;
                          e.stopPropagation();
                          const r = frame.current!.getBoundingClientRect();
                          const pt = onSeg(a, b, atRect(e, r));
                          const next = { pts: [...p.pts.slice(0, j + 1), pt, ...p.pts.slice(j + 1)] };
                          polySnap.current = livePolys.current;
                          frameR.current = r;
                          applyPolys(livePolys.current.map((q, k) => (k === i ? next : q)));
                          selVert.current = { i, j: j + 1 };
                          polyGest.current = { t: "vertex", i, j: j + 1 };
                          setPolyHold(i);
                          setVertHold(j + 1);
                        }}
                      />
                    );
                  })}
                </g>
              ))}
              {polyDraft && cursor && (
                <polyline className="poly draft" points={ptsStr([...polyDraft, cursor])} />
              )}
              {polyDraft && polyDraft.length >= 2 && cursor && (
                <line className="ghost" x1={cursor.x} y1={cursor.y} x2={polyDraft[0].x} y2={polyDraft[0].y} />
              )}
            </svg>
            {polyEdit && !drawing && polys.map((p, i) =>
              p.pts.map((pt, j) => (
                <span
                  key={`${i}-${j}`}
                  className={`pv${polyHold === i && vertHold === j ? " on" : ""}`}
                  style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                  onPointerDown={(e) => startPoly(e, { t: "vertex", i, j })}
                />
              )),
            )}
            {drawing && polyDraft?.map((pt, j) => (
              <span
                key={`d-${j}`}
                className={`pv${j === 0 && polyDraft.length >= 3 ? " close" : ""}`}
                style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (j === 0 && polyDraft.length >= 3) closePoly();
                }}
              />
            ))}
          </div>
          {hands.map((obj, h) => obj.geom.t === "hand" && (
          <div key={obj.id} className={`hand${tool === "landmarks" && !locked ? " edit" : ""}`} style={{ "--c": HAND_COLOR[h % HAND_COLOR.length] } as CSSProperties}>
            <svg viewBox="0 0 1 1" preserveAspectRatio="none">
              {CONNECTIONS.map(([a, b]) => (
                <line key={`${a}-${b}`} x1={obj.geom.landmarks[a].x} y1={obj.geom.landmarks[a].y} x2={obj.geom.landmarks[b].x} y2={obj.geom.landmarks[b].y} />
              ))}
            </svg>
            {obj.geom.landmarks.map((p, i) => (
              <span
                key={i}
                className={`pt${hold?.h === h && hold.i === i ? " on" : ""}`}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                onPointerDown={(e) => {
                  if (locked) return;
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  frameR.current = frame.current!.getBoundingClientRect();
                  sel.current = { h, i };
                  dragPt.current = { h, i, start: live.current };
                  setHold({ h, i });
                }}
              >
                <span className="chip">{i}</span>
              </span>
            ))}
          </div>
          ))}
        </div>
      </div>
    </main>
    <div className="stack">
    <div className="panel tools">
      {TOOLS.filter((t) => shown.includes(t.id)).map((t) => (
        <Fragment key={t.id}>
        {t.id === "assist" && <hr />}
        <button
          type="button"
          aria-label={t.label}
          aria-pressed={t.id !== "assist" && tool === t.id}
          onClick={() => (t.id === "assist" ? onAssist?.() : setTool(t.id))}
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
