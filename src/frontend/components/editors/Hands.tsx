"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE, type RefObject } from "react";
import { CONNECTIONS, NAMES } from "@/lib/hand";
import { classColor, type HandObj } from "@/lib/doc";
import { atRect, clamp01 } from "@/lib/geom";

export default function Hands({
  objects,
  classes,
  locked,
  active,
  selectedId,
  onChange,
  onSelect,
  onEdit,
  frameRef,
}: {
  objects: HandObj[];
  classes: string[];
  locked: boolean;
  active: boolean;
  selectedId: string | null;
  onChange: (next: HandObj[], undoable?: boolean) => void;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  frameRef: RefObject<HTMLDivElement | null>;
}) {
  const [hold, setHold] = useState<{ h: number; i: number } | null>(null);
  const live = useRef(objects);
  const dragPt = useRef<{ h: number; i: number; start: HandObj[] } | null>(null);
  const frameR = useRef<DOMRect | null>(null);
  const sel = useRef<{ h: number; i: number } | null>(null);
  live.current = objects;

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

  useEffect(() => {
    if (hold == null) return;
    const move = (e: PointerEvent) => {
      const d = dragPt.current;
      const r = frameR.current;
      if (!d || !r) return;
      const p = atRect(e, r);
      onChange(patchLm(d.h, d.i, p.x, p.y), false);
    };
    const up = () => {
      const d = dragPt.current;
      const r = frameR.current;
      dragPt.current = null;
      frameR.current = null;
      setHold(null);
      if (!d) return;
      const now = live.current[d.h]?.geom.landmarks[d.i];
      const was = d.start[d.h]?.geom.landmarks[d.i];
      if (!now || !was) return;
      const moved = r && Math.hypot((now.x - was.x) * r.width, (now.y - was.y) * r.height) > 4;
      if (!moved) {
        onChange(d.start, false);
        onSelect(d.start[d.h]?.id ?? null);
        onEdit(d.start[d.h]?.id ?? null);
        return;
      }
      onChange(live.current, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [hold, onChange, onEdit, onSelect]);

  useEffect(() => {
    if (!active || locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!e.key.startsWith("Arrow") || sel.current == null) return;
      e.preventDefault();
      const r = frameRef.current?.getBoundingClientRect();
      const dx = (e.shiftKey ? 10 : 1) / (r?.width || 500);
      const dy = (e.shiftKey ? 10 : 1) / (r?.height || 500);
      const s = sel.current;
      const obj = live.current[s.h];
      if (!obj) return;
      const p = obj.geom.landmarks[s.i];
      const x = clamp01(p.x + (e.key === "ArrowRight" ? dx : e.key === "ArrowLeft" ? -dx : 0));
      const y = clamp01(p.y + (e.key === "ArrowDown" ? dy : e.key === "ArrowUp" ? -dy : 0));
      if (x === p.x && y === p.y) return;
      onChange(patchLm(s.h, s.i, x, y), true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, locked, frameRef, onChange]);

  return objects.map((obj, h) => (
    <div
      key={obj.id}
      className={`hand${active && !locked ? " edit" : ""}${selectedId === obj.id ? " sel" : ""}`}
      style={{ "--c": classColor(obj.label, classes) } as CSSProperties}
    >
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {CONNECTIONS.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={obj.geom.landmarks[a].x}
            y1={obj.geom.landmarks[a].y}
            x2={obj.geom.landmarks[b].x}
            y2={obj.geom.landmarks[b].y}
          />
        ))}
      </svg>
      {obj.geom.landmarks.map((p, i) => (
        <span
          key={i}
          role="button"
          tabIndex={active && !locked ? 0 : -1}
          aria-label={`${NAMES[i] ?? i}`}
          className={`pt${hold?.h === h && hold.i === i ? " on" : ""}`}
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          onFocus={() => {
            sel.current = { h, i };
            onSelect(obj.id);
          }}
          onPointerDown={(e: PE<HTMLSpanElement>) => {
            if (locked || !active) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            frameR.current = frameRef.current!.getBoundingClientRect();
            sel.current = { h, i };
            onSelect(obj.id);
            dragPt.current = { h, i, start: live.current };
            setHold({ h, i });
          }}
        >
          <span className="chip" aria-hidden="true">
            {i}
          </span>
        </span>
      ))}
    </div>
  ));
}
