"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE, type RefObject } from "react";
import { connectionsFor, nameFor } from "../../geometry/hand";
import { classColor, type HandObj } from "../../geometry/doc";
import { atRect, clamp01, ptStyle, trackPointer } from "../../geometry/geom";

export default function Hands({
  objects,
  classes,
  locked,
  canDrag = true,
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
  canDrag?: boolean;
  active: boolean;
  selectedId: string | null;
  onChange: (next: HandObj[], undoable?: boolean) => void;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  frameRef: RefObject<HTMLDivElement | null>;
}) {
  const [hold, setHold] = useState<{ h: number; i: number } | null>(null);
  const live = useRef(objects);
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  const onEditRef = useRef(onEdit);
  const sel = useRef<{ h: number; i: number } | null>(null);

  useEffect(() => {
    live.current = objects;
    onChangeRef.current = onChange;
    onSelectRef.current = onSelect;
    onEditRef.current = onEdit;
  }, [objects, onChange, onSelect, onEdit]);

  const patchLm = (h: number, i: number, x: number, y: number) =>
    live.current.map((o, k) =>
      k !== h
        ? o
        : {
            ...o,
            edited: true,
            // free-landmark edit invalidates agent FK rig
            geom: {
              ...o.geom,
              rig: null,
              landmarks: o.geom.landmarks.map((q, j) => (j === i ? { ...q, x, y } : q)),
            },
          },
    );

  useEffect(() => {
    if (!active || locked || !canDrag) return;
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
      onChangeRef.current(patchLm(s.h, s.i, x, y), true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, locked, canDrag, frameRef]);

  const startPt = (e: PE<HTMLSpanElement>, h: number, i: number, objId: string) => {
    if (locked || !active) return;
    e.stopPropagation();
    e.preventDefault();
    const frameR = frameRef.current!.getBoundingClientRect();
    const start = live.current;
    const ox = e.clientX;
    const oy = e.clientY;
    sel.current = { h, i };
    onSelectRef.current(objId);
    setHold({ h, i });

    // window listeners — setHold re-renders and would drop element-bound ups
    const move = (ev: PointerEvent) => {
      if (!canDrag) return;
      const p = atRect(ev, frameR);
      onChangeRef.current(patchLm(h, i, p.x, p.y), false);
    };
    const up = (ev: PointerEvent) => {
      setHold(null);
      const dist = Math.hypot(ev.clientX - ox, ev.clientY - oy);
      if (!canDrag || dist <= 4) {
        onChangeRef.current(start, false);
        onSelectRef.current(objId);
        onEditRef.current(objId);
        return;
      }
      onChangeRef.current(live.current, true);
    };
    trackPointer(move, up);
  };

  return objects.map((obj, h) => {
    const n = obj.geom.landmarks.length;
    // face mesh (~478): numbered chips become a solid slab — dots only
    const mesh = n > 40;
    return (
      <div
        key={obj.id}
        className={`hand${mesh ? " mesh" : ""}${active && !locked ? " edit" : ""}${selectedId === obj.id ? " sel" : ""}`}
        style={{ "--c": classColor(obj.label, classes) } as CSSProperties}
      >
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          {connectionsFor(n).map(([a, b]) => {
            const pa = obj.geom.landmarks[a];
            const pb = obj.geom.landmarks[b];
            if (!pa || !pb) return null;
            return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />;
          })}
        </svg>
        {obj.geom.landmarks.map((p, i) => (
          <span
            key={i}
            role="button"
            tabIndex={active && !locked ? 0 : -1}
            aria-label={nameFor(i, n)}
            className={`pt${hold?.h === h && hold.i === i ? " on" : ""}`}
            style={ptStyle(p)}
            onFocus={() => {
              sel.current = { h, i };
              onSelect(obj.id);
            }}
            onPointerDown={(e) => startPt(e, h, i, obj.id)}
          >
            {!mesh && (
              <span className="chip" aria-hidden="true">
                {i}
              </span>
            )}
          </span>
        ))}
      </div>
    );
  });
}
