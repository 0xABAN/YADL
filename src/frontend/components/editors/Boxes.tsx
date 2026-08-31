"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE, type RefObject } from "react";
import { classColor, newId, type BoxObj } from "@/lib/doc";
import {
  HANDLES,
  atRect,
  boxFrom,
  boxStyle,
  eqBox,
  resizeBox,
  shiftBox,
  tiny,
  type Box,
} from "@/lib/geom";

type Gest =
  | { t: "draw"; x0: number; y0: number }
  | { t: "resize"; i: number; ax: number | null; ay: number | null; start: Box }
  | { t: "move"; i: number; x0: number; y0: number; start: Box };

export default function Boxes({
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
  objects: BoxObj[];
  classes: string[];
  locked: boolean;
  active: boolean;
  selectedId: string | null;
  onChange: (next: BoxObj[], undoable?: boolean) => void;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  frameRef: RefObject<HTMLDivElement | null>;
}) {
  const [draft, setDraft] = useState<Box | null>(null);
  const [hold, setHold] = useState<number | "draw" | null>(null);
  const live = useRef(objects);
  const gest = useRef<Gest | null>(null);
  const snap = useRef<BoxObj[]>([]);
  const draftRef = useRef<Box | null>(null);
  const frameR = useRef<DOMRect | null>(null);
  live.current = objects;

  const boxes = objects.map((o) => o.geom);

  const abort = () => {
    if (gest.current && gest.current.t !== "draw") onChange(snap.current, false);
    gest.current = null;
    frameR.current = null;
    draftRef.current = null;
    setDraft(null);
    setHold(null);
  };

  useEffect(() => {
    if (active && !locked) return;
    if (gest.current) abort();
  }, [active, locked]);

  useEffect(() => {
    if (hold == null) return;
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
        onChange(
          live.current.map((o, i) =>
            i === g.i ? { ...o, edited: true, geom: { t: "box", ...resizeBox(g, p) } } : o,
          ),
          false,
        );
      } else {
        onChange(
          live.current.map((o, i) =>
            i === g.i
              ? { ...o, edited: true, geom: { t: "box", ...shiftBox(g.start, p.x - g.x0, p.y - g.y0) } }
              : o,
          ),
          false,
        );
      }
    };
    const up = () => {
      const g = gest.current;
      const r = frameR.current;
      gest.current = null;
      frameR.current = null;
      setHold(null);
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
        const obj: BoxObj = {
          id: newId("box"),
          kind: "box",
          label: null,
          edited: true,
          geom: { t: "box", ...b },
        };
        const next = [...snap.current, obj];
        onChange(next, true);
        onSelect(obj.id);
        onEdit(obj.id);
        return;
      }
      const b = live.current[g.i]?.geom;
      if (!b) return;
      if (g.t === "resize" && tiny(b, r)) {
        onChange(snap.current, false);
        return;
      }
      if (eqBox(b, snap.current[g.i].geom)) return;
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
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape" && gest.current) {
        e.preventDefault();
        abort();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const start = (e: PE<HTMLElement>, g: Gest) => {
    if (locked || !active) return;
    e.stopPropagation();
    const r = frameRef.current!.getBoundingClientRect();
    frameR.current = r;
    snap.current = live.current;
    if (g.t === "move") {
      const p = atRect(e, r);
      g.x0 = p.x;
      g.y0 = p.y;
      onSelect(live.current[g.i]?.id ?? null);
    }
    if (g.t === "resize") onSelect(live.current[g.i]?.id ?? null);
    gest.current = g;
    setHold(g.t === "draw" ? "draw" : g.i);
  };

  const onFramePointerDown = (e: PE<HTMLElement>) => {
    if (locked || !active || hold != null) return;
    const r = frameRef.current!.getBoundingClientRect();
    frameR.current = r;
    const { x, y } = atRect(e, r);
    snap.current = live.current;
    gest.current = { t: "draw", x0: x, y0: y };
    const z = { x, y, w: 0, h: 0 };
    draftRef.current = z;
    setDraft(z);
    setHold("draw");
  };

  return (
    <div
      className={`boxes${active && !locked ? " edit" : ""}`}
      onPointerDown={active ? onFramePointerDown : undefined}
    >
      {objects.map((o, i) => {
        const b = o.geom;
        return (
          <div
            key={o.id}
            className={`box${hold === i ? " on" : ""}${selectedId === o.id ? " sel" : ""}`}
            style={
              {
                ...boxStyle(b),
                "--c": classColor(o.label, classes),
              } as CSSProperties
            }
            onPointerDown={(e) => start(e, { t: "move", i, x0: 0, y0: 0, start: b })}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onSelect(o.id);
              onEdit(o.id);
            }}
          >
            {HANDLES.map((h) => (
              <span
                key={h.c}
                className={`h ${h.c}`}
                role="button"
                tabIndex={-1}
                aria-label={`Resize ${h.c}`}
                onPointerDown={(e) =>
                  start(e, { t: "resize", i, ax: h.ax(b), ay: h.ay(b), start: b })
                }
              />
            ))}
          </div>
        );
      })}
      {draft && <div className="box draft" style={boxStyle(draft)} />}
    </div>
  );
}
