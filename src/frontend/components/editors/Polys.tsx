"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as PE, type RefObject } from "react";
import { classColor, newId, type PolyObj, type Pt } from "@/lib/doc";
import { atRect, eqPoly, nearPx, onSeg, ptsStr, shiftPoly, tinyPoly } from "@/lib/geom";

type Gest =
  | { t: "draw" }
  | { t: "vertex"; i: number; j: number }
  | { t: "move"; i: number; x0: number; y0: number; start: Pt[] };

export default function Polys({
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
  objects: PolyObj[];
  classes: string[];
  locked: boolean;
  active: boolean;
  selectedId: string | null;
  onChange: (next: PolyObj[], undoable?: boolean) => void;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  frameRef: RefObject<HTMLDivElement | null>;
}) {
  const [draft, setDraft] = useState<Pt[] | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hold, setHold] = useState<number | "draw" | null>(null);
  const [vertHold, setVertHold] = useState<number | null>(null);
  const live = useRef(objects);
  const gest = useRef<Gest | null>(null);
  const snap = useRef<PolyObj[]>([]);
  const draftRef = useRef<Pt[] | null>(null);
  const frameR = useRef<DOMRect | null>(null);
  const selVert = useRef<{ i: number; j: number } | null>(null);
  live.current = objects;

  const abort = () => {
    if (gest.current && gest.current.t !== "draw") onChange(snap.current, false);
    gest.current = null;
    draftRef.current = null;
    frameR.current = null;
    setDraft(null);
    setCursor(null);
    setHold(null);
    setVertHold(null);
  };

  const close = () => {
    const d = draftRef.current;
    const r = frameRef.current?.getBoundingClientRect();
    gest.current = null;
    draftRef.current = null;
    setDraft(null);
    setCursor(null);
    setHold(null);
    setVertHold(null);
    if (!d || d.length < 3 || !r || tinyPoly(d, r)) return;
    const obj: PolyObj = {
      id: newId("poly"),
      kind: "polygon",
      label: null,
      edited: true,
      geom: { t: "polygon", pts: d },
    };
    onChange([...live.current, obj], true);
    onSelect(obj.id);
    onEdit(obj.id);
  };

  const popDraft = () => {
    const d = draftRef.current;
    if (!d) return;
    if (d.length <= 1) {
      abort();
      return;
    }
    const n = d.slice(0, -1);
    draftRef.current = n;
    setDraft(n);
  };

  useEffect(() => {
    if (active && !locked) return;
    if (gest.current || draftRef.current) abort();
  }, [active, locked]);

  useEffect(() => {
    if (hold !== "draw") return;
    const move = (e: PointerEvent) => {
      const el = frameRef.current;
      if (!el) return;
      setCursor(atRect(e, el.getBoundingClientRect()));
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [hold, frameRef]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape" && (gest.current || draftRef.current)) {
        e.preventDefault();
        abort();
        return;
      }
      if (e.key === "Enter" && draftRef.current && draftRef.current.length >= 3) {
        e.preventDefault();
        close();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && draftRef.current) {
        e.preventDefault();
        popDraft();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selVert.current && !locked) {
        e.preventDefault();
        const s = selVert.current;
        const p = live.current[s.i];
        if (!p || p.geom.pts.length <= 3) return;
        onChange(
          live.current.map((o, k) =>
            k !== s.i ? o : { ...o, edited: true, geom: { t: "polygon", pts: o.geom.pts.filter((_, j) => j !== s.j) } },
          ),
          true,
        );
        selVert.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, locked, onChange]);

  const start = (e: PE<Element>, g: Exclude<Gest, { t: "draw" }>) => {
    if (locked || !active || draftRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const r = frameRef.current!.getBoundingClientRect();
    frameR.current = r;
    snap.current = live.current;
    if (g.t === "move") {
      const p = atRect(e, r);
      g.x0 = p.x;
      g.y0 = p.y;
      onSelect(live.current[g.i]?.id ?? null);
    }
    if (g.t === "vertex") {
      selVert.current = { i: g.i, j: g.j };
      setVertHold(g.j);
      onSelect(live.current[g.i]?.id ?? null);
    }
    gest.current = g;
    // attach immediately so a fast click can't miss pointerup (useEffect race)
    const move = (ev: PointerEvent) => {
      const gg = gest.current;
      if (!gg || gg.t === "draw") return;
      const p = atRect(ev, r);
      if (gg.t === "vertex") {
        onChange(
          live.current.map((o, i) =>
            i !== gg.i
              ? o
              : {
                  ...o,
                  edited: true,
                  geom: { t: "polygon", pts: o.geom.pts.map((pt, j) => (j === gg.j ? p : pt)) },
                },
          ),
          false,
        );
      } else {
        onChange(
          live.current.map((o, i) =>
            i !== gg.i
              ? o
              : {
                  ...o,
                  edited: true,
                  geom: { t: "polygon", pts: shiftPoly(gg.start, p.x - gg.x0, p.y - gg.y0) },
                },
          ),
          false,
        );
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const gg = gest.current;
      gest.current = null;
      frameR.current = null;
      setHold(null);
      setVertHold(null);
      if (!gg || gg.t === "draw") return;
      const poly = live.current[gg.i];
      if (!poly || tinyPoly(poly.geom.pts, r)) {
        onChange(snap.current, false);
        return;
      }
      if (eqPoly(poly.geom.pts, snap.current[gg.i].geom.pts)) {
        const id = live.current[gg.i]?.id;
        if (id) {
          onSelect(id);
          onEdit(id);
        }
        return;
      }
      onChange(live.current, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    setHold(g.i);
  };

  const plant = (e: PE<HTMLElement>) => {
    const r = frameRef.current!.getBoundingClientRect();
    const p = atRect(e, r);
    const d = draftRef.current;
    if (!d) {
      draftRef.current = [p];
      gest.current = { t: "draw" };
      setDraft([p]);
      setCursor(p);
      setHold("draw");
      return;
    }
    if (d.length >= 3 && nearPx(p, d[0], r, 12)) {
      close();
      return;
    }
    if (nearPx(p, d[d.length - 1], r, 4)) return;
    const n = [...d, p];
    draftRef.current = n;
    setDraft(n);
  };

  const drawing = hold === "draw";
  const edit = active && !locked;

  return (
    <div
      className={`polys${edit ? " edit" : ""}`}
      onPointerDown={
        edit
          ? (e) => {
              if (typeof hold === "number") return;
              plant(e);
            }
          : undefined
      }
      onDoubleClick={
        edit
          ? (e) => {
              e.preventDefault();
              if (draftRef.current && draftRef.current.length >= 3) close();
            }
          : undefined
      }
    >
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {objects.map((o, i) => (
          <g key={o.id}>
            <polygon
              className={`poly${hold === i ? " on" : ""}${selectedId === o.id ? " sel" : ""}`}
              points={ptsStr(o.geom.pts)}
              style={{ "--c": classColor(o.label, classes) } as CSSProperties}
              onPointerDown={(e) => start(e, { t: "move", i, x0: 0, y0: 0, start: o.geom.pts })}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onSelect(o.id);
                onEdit(o.id);
              }}
            />
            {edit &&
              !drawing &&
              o.geom.pts.map((a, j) => {
                const b = o.geom.pts[(j + 1) % o.geom.pts.length];
                return (
                  <line
                    key={j}
                    className="edge"
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    onPointerDown={(e) => {
                      if (locked || !active) return;
                      e.stopPropagation();
                      const r = frameRef.current!.getBoundingClientRect();
                      const pt = onSeg(a, b, atRect(e, r));
                      const pts = [...o.geom.pts.slice(0, j + 1), pt, ...o.geom.pts.slice(j + 1)];
                      snap.current = live.current;
                      frameR.current = r;
                      onChange(
                        live.current.map((q, k) =>
                          k === i ? { ...q, edited: true, geom: { t: "polygon", pts } } : q,
                        ),
                        false,
                      );
                      selVert.current = { i, j: j + 1 };
                      gest.current = { t: "vertex", i, j: j + 1 };
                      setHold(i);
                      setVertHold(j + 1);
                    }}
                  />
                );
              })}
          </g>
        ))}
        {draft && cursor && <polyline className="poly draft" points={ptsStr([...draft, cursor])} />}
        {draft && draft.length >= 2 && cursor && (
          <line className="ghost" x1={cursor.x} y1={cursor.y} x2={draft[0].x} y2={draft[0].y} />
        )}
      </svg>
      {edit &&
        !drawing &&
        objects.map((o, i) =>
          o.geom.pts.map((pt, j) => (
            <span
              key={`${o.id}-${j}`}
              role="button"
              tabIndex={-1}
              aria-label={`Vertex ${j + 1}`}
              className={`pv${hold === i && vertHold === j ? " on" : ""}`}
              style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
              onPointerDown={(e) => start(e, { t: "vertex", i, j })}
            />
          )),
        )}
      {drawing &&
        draft?.map((pt, j) => (
          <span
            key={`d-${j}`}
            role="button"
            tabIndex={-1}
            aria-label={j === 0 && draft.length >= 3 ? "Close polygon" : `Point ${j + 1}`}
            className={`pv${j === 0 && draft.length >= 3 ? " close" : ""}`}
            style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (j === 0 && draft.length >= 3) close();
            }}
          />
        ))}
    </div>
  );
}
