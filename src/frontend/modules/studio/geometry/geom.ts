import type { CSSProperties } from "react";
import type { Pt } from "./doc";

export type Box = { x: number; y: number; w: number; h: number };

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const atRect = (e: { clientX: number; clientY: number }, r: DOMRect): Pt => ({
  x: clamp01((e.clientX - r.left) / r.width),
  y: clamp01((e.clientY - r.top) / r.height),
});

export const boxFrom = (x0: number, y0: number, x1: number, y1: number): Box => {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
};

export const shiftBox = (b: Box, dx: number, dy: number): Box => ({
  ...b,
  x: Math.min(Math.max(0, b.x + dx), 1 - b.w),
  y: Math.min(Math.max(0, b.y + dy), 1 - b.h),
});

export const eqBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export const tiny = (b: Box, r: DOMRect) => b.w * r.width < 4 && b.h * r.height < 4;

export const boxStyle = (b: Box): CSSProperties => ({
  left: `${b.x * 100}%`,
  top: `${b.y * 100}%`,
  width: `${b.w * 100}%`,
  height: `${b.h * 100}%`,
});

export const ptStyle = (p: Pt): CSSProperties => ({
  left: `${p.x * 100}%`,
  top: `${p.y * 100}%`,
});

/** Window-level pointer drag: move + up/cancel with auto teardown. */
export function trackPointer(move: (e: PointerEvent) => void, up: (e: PointerEvent) => void) {
  const end = (e: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    up(e);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

export const ptsStr = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");

export const eqPoly = (a: Pt[], b: Pt[]) =>
  a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

export const tinyPoly = (pts: Pt[], r: DOMRect) => {
  let x0 = 1,
    y0 = 1,
    x1 = 0,
    y1 = 0;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return tiny({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, r);
};

export const shiftPoly = (pts: Pt[], dx: number, dy: number): Pt[] => {
  let loX = -Infinity,
    hiX = Infinity,
    loY = -Infinity,
    hiY = Infinity;
  for (const q of pts) {
    loX = Math.max(loX, -q.x);
    hiX = Math.min(hiX, 1 - q.x);
    loY = Math.max(loY, -q.y);
    hiY = Math.min(hiY, 1 - q.y);
  }
  const x = Math.min(Math.max(dx, loX), hiX);
  const y = Math.min(Math.max(dy, loY), hiY);
  return pts.map((q) => ({ x: q.x + x, y: q.y + y }));
};

export const nearPx = (a: Pt, b: Pt, r: DOMRect, px: number) => {
  const dx = (a.x - b.x) * r.width,
    dy = (a.y - b.y) * r.height;
  return dx * dx + dy * dy < px * px;
};

export const onSeg = (a: Pt, b: Pt, p: Pt): Pt => {
  const abx = b.x - a.x,
    aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  const t = l2 === 0 ? 0 : clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2);
  return { x: a.x + abx * t, y: a.y + aby * t };
};

export const HANDLES: { c: string; ax: (b: Box) => number | null; ay: (b: Box) => number | null }[] = [
  { c: "nw", ax: (b) => b.x + b.w, ay: (b) => b.y + b.h },
  { c: "n", ax: () => null, ay: (b) => b.y + b.h },
  { c: "ne", ax: (b) => b.x, ay: (b) => b.y + b.h },
  { c: "e", ax: (b) => b.x, ay: () => null },
  { c: "se", ax: (b) => b.x, ay: (b) => b.y },
  { c: "s", ax: () => null, ay: (b) => b.y },
  { c: "sw", ax: (b) => b.x + b.w, ay: (b) => b.y },
  { c: "w", ax: (b) => b.x + b.w, ay: () => null },
];

export const resizeBox = (
  g: { ax: number | null; ay: number | null; start: Box },
  p: Pt,
): Box =>
  boxFrom(
    g.ax ?? g.start.x,
    g.ay ?? g.start.y,
    g.ax != null ? p.x : g.start.x + g.start.w,
    g.ay != null ? p.y : g.start.y + g.start.h,
  );
