"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE, type RefObject } from "react";
import { classColor, named, newId, type BoxObj } from "@/lib/doc";
import {
  HANDLES,
  atRect,
  boxFrom,
  boxStyle,
  eqBox,
  resizeBox,
  shiftBox,
  tiny,
  trackPointer,
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
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  const onEditRef = useRef(onEdit);
  const gest = useRef<Gest | null>(null);
  live.current = objects;
  onChangeRef.current = onChange;
  onSelectRef.current = onSelect;
  onEditRef.current = onEdit;

  const abort = () => {
    if (gest.current && gest.current.t !== "draw") onChangeRef.current(live.current, false);
    gest.current = null;
    setDraft(null);
    setHold(null);
  };

  useEffect(() => {
    if (active && !locked) return;
    if (gest.current) abort();
  }, [active, locked]);

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

  const track = (g: Gest, snap: BoxObj[], frameR: DOMRect) => {
    gest.current = g;
    setHold(g.t === "draw" ? "draw" : g.i);
    let drawBox: Box | null = g.t === "draw" ? { x: g.x0, y: g.y0, w: 0, h: 0 } : null;

    const move = (ev: PointerEvent) => {
      const cur = gest.current;
      if (!cur) return;
      const p = atRect(ev, frameR);
      if (cur.t === "draw") {
        drawBox = boxFrom(cur.x0, cur.y0, p.x, p.y);
        setDraft(drawBox);
      } else if (cur.t === "resize") {
        onChangeRef.current(
          live.current.map((o, i) =>
            i === cur.i ? { ...o, edited: true, geom: { t: "box", ...resizeBox(cur, p) } } : o,
          ),
          false,
        );
      } else {
        onChangeRef.current(
          live.current.map((o, i) =>
            i === cur.i
              ? { ...o, edited: true, geom: { t: "box", ...shiftBox(cur.start, p.x - cur.x0, p.y - cur.y0) } }
              : o,
          ),
          false,
        );
      }
    };

    const up = () => {
      const cur = gest.current;
      gest.current = null;
      setHold(null);
      setDraft(null);
      if (!cur) return;
      if (cur.t === "draw") {
        const b = drawBox;
        if (!b || tiny(b, frameR)) return;
        const obj: BoxObj = {
          id: newId("box"),
          kind: "box",
          label: null,
          edited: true,
          geom: { t: "box", ...b },
        };
        onChangeRef.current([...snap, obj], true);
        onSelectRef.current(obj.id);
        onEditRef.current(obj.id);
        return;
      }
      const b = live.current[cur.i]?.geom;
      if (!b) return;
      if (cur.t === "resize" && tiny(b, frameR)) {
        onChangeRef.current(snap, false);
        return;
      }
      if (eqBox(b, snap[cur.i].geom)) {
        const id = live.current[cur.i]?.id;
        if (id) {
          onSelectRef.current(id);
          onEditRef.current(id);
        }
        return;
      }
      onChangeRef.current(live.current, true);
    };

    trackPointer(move, up);
  };

  const start = (e: PE<HTMLElement>, g: Gest) => {
    if (locked || !active) return;
    e.stopPropagation();
    e.preventDefault();
    const r = frameRef.current!.getBoundingClientRect();
    const snap = live.current;
    if (g.t === "move") {
      const p = atRect(e, r);
      g.x0 = p.x;
      g.y0 = p.y;
      onSelectRef.current(live.current[g.i]?.id ?? null);
    }
    if (g.t === "resize") onSelectRef.current(live.current[g.i]?.id ?? null);
    track(g, snap, r);
  };

  const onFramePointerDown = (e: PE<HTMLElement>) => {
    if (locked || !active || hold != null) return;
    // only start draw if the event is on the layer itself, not a child box
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    const r = frameRef.current!.getBoundingClientRect();
    const { x, y } = atRect(e, r);
    track({ t: "draw", x0: x, y0: y }, live.current, r);
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
          >
            {named(o.label) && (
              <span className="box-tab">{named(o.label)}</span>
            )}
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
