"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type PointerEvent as PE } from "react";
import {
  DEFAULT_TOOL,
  SHOWN,
  type AnnObj,
  type BoxObj,
  type HandObj,
  type PolyObj,
  type Project,
  type ToolId,
} from "@/lib/doc";
import Hands from "./editors/Hands";
import Boxes from "./editors/Boxes";
import Polys from "./editors/Polys";

const STEP = 10;
const MIN = 25;
const MAX = 400;

const TOOLS = [
  {
    id: "move",
    label: "Pan",
    d: "M168,132.69,214.08,115l.33-.13A16,16,0,0,0,213,85.07L52.92,32.8A15.95,15.95,0,0,0,32.8,52.92L85.07,213a15.82,15.82,0,0,0,14.41,11l.78,0a15.84,15.84,0,0,0,14.61-9.59l.13-.33L132.69,168,184,219.31a16,16,0,0,0,22.63,0l12.68-12.68a16,16,0,0,0,0-22.63ZM195.31,208,144,156.69a16,16,0,0,0-26,4.93c0,.11-.09.22-.13.32l-17.65,46L48,48l159.85,52.2-45.95,17.64-.32.13a16,16,0,0,0-4.93,26h0L208,195.31Z",
  },
  {
    id: "box",
    label: "Bounding Box",
    d: "M208,96a16,16,0,0,0,16-16V48a16,16,0,0,0-16-16H176a16,16,0,0,0-16,16v8H96V48A16,16,0,0,0,80,32H48A16,16,0,0,0,32,48V80A16,16,0,0,0,48,96h8v64H48a16,16,0,0,0-16,16v32a16,16,0,0,0,16,16H80a16,16,0,0,0,16-16v-8h64v8a16,16,0,0,0,16,16h32a16,16,0,0,0,16-16V176a16,16,0,0,0-16-16h-8V96ZM176,48h32V80H176ZM48,48H80V63.9a.51.51,0,0,0,0,.2V80H48ZM80,208H48V176H80v15.9a.51.51,0,0,0,0,.2V208Zm128,0H176V176h32Zm-24-48h-8a16,16,0,0,0-16,16v8H96v-8a16,16,0,0,0-16-16H72V96h8A16,16,0,0,0,96,80V72h64v8a16,16,0,0,0,16,16h8Z",
  },
  {
    id: "polygon",
    label: "Polygon",
    d: "M230.64,49.36a32,32,0,0,0-45.26,0h0a31.9,31.9,0,0,0-5.16,6.76L152,48.42A32,32,0,0,0,97.37,25.36h0a32.06,32.06,0,0,0-5.76,37.41L57.67,93.32a32.05,32.05,0,0,0-40.31,4.05h0a32,32,0,0,0,42.89,47.41l70,51.36a32,32,0,1,0,47.57-14.69l27.39-77.59q1.38.12,2.76.12a32,32,0,0,0,22.63-54.62Zm-122-12.69h0a16,16,0,1,1,0,22.64A16,16,0,0,1,108.68,36.67Zm-80,94.65a16,16,0,0,1,0-22.64h0a16,16,0,1,1,0,22.64Zm142.65,88a16,16,0,0,1-22.63-22.63h0a16,16,0,1,1,22.63,22.63Zm-8.55-43.18a32,32,0,0,0-23,7.08l-70-51.36a32.17,32.17,0,0,0-1.34-26.65l33.95-30.55a32,32,0,0,0,45.47-10.81L176,71.56a32,32,0,0,0,14.12,27Zm56.56-92.84A16,16,0,1,1,196.7,60.68h0a16,16,0,0,1,22.63,22.63Z",
  },
  {
    id: "assist",
    label: "Label Assist",
    d: "M48,64a8,8,0,0,1,8-8H72V40a8,8,0,0,1,16,0V56h16a8,8,0,0,1,0,16H88V88a8,8,0,0,1-16,0V72H56A8,8,0,0,1,48,64ZM184,192h-8v-8a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0v-8h8a8,8,0,0,0,0-16Zm56-48H224V128a8,8,0,0,0-16,0v16H192a8,8,0,0,0,0,16h16v16a8,8,0,0,0,16,0V160h16a8,8,0,0,0,0-16ZM219.31,80,80,219.31a16,16,0,0,1-22.62,0L36.68,198.63a16,16,0,0,1,0-22.63L176,36.69a16,16,0,0,1,22.63,0l20.68,20.68A16,16,0,0,1,219.31,80Zm-54.63,32L144,91.31l-96,96L68.68,208ZM208,68.69,187.31,48l-32,32L176,100.69Z",
  },
] as const;

export default function Canvas({
  src = "/default.jpg",
  alt = "Sample",
  objects = [],
  projectType = "hands",
  onChange,
  onAssistOn,
  assistOn = true,
  assistBusy = false,
  onEdit,
  onSelect,
  selectedId = null,
  classes = [],
  tool: toolProp,
  onTool,
}: {
  src?: string;
  alt?: string;
  objects?: AnnObj[];
  projectType?: Project["type"];
  onChange?: (objects: AnnObj[]) => void;
  onAssistOn?: () => void;
  assistOn?: boolean;
  assistBusy?: boolean;
  onEdit?: (id: string | null) => void;
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  classes?: string[];
  tool?: ToolId;
  onTool?: (t: ToolId) => void;
}) {
  const shown = SHOWN[projectType];
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(100);
  const [locked, setLocked] = useState(false);
  const [tool, setToolInner] = useState<ToolId>(toolProp ?? DEFAULT_TOOL[projectType]);
  const [tip, setTip] = useState<string | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const spacePan = useRef(false);
  const undo = useRef<AnnObj[][]>([]);
  const redo = useRef<AnnObj[][]>([]);
  const [hist, setHist] = useState({ u: 0, r: 0 });
  const live = useRef(objects);
  live.current = objects;
  const tickHist = () => setHist({ u: undo.current.length, r: redo.current.length });

  useEffect(() => {
    if (toolProp) setToolInner(toolProp);
  }, [toolProp]);

  useEffect(() => {
    setToolInner(DEFAULT_TOOL[projectType]);
    undo.current = [];
    redo.current = [];
    setHist({ u: 0, r: 0 });
  }, [src, projectType]);

  useEffect(() => {
    setImgReady(false);
    let dead = false;
    const im = new window.Image();
    const done = () => {
      if (!dead) setImgReady(true);
    };
    im.onload = done;
    im.onerror = done;
    im.src = src;
    if (im.complete && im.naturalWidth > 0) done();
    return () => {
      dead = true;
    };
  }, [src]);

  const setTool = (t: ToolId) => {
    setToolInner(t);
    onTool?.(t);
  };

  const commit = useCallback(
    (next: AnnObj[], undoable = true) => {
      if (undoable !== false) {
        undo.current.push(live.current);
        if (undo.current.length > 50) undo.current.shift();
        redo.current = [];
      }
      live.current = next;
      onChange?.(next);
      tickHist();
    },
    [onChange],
  );

  const doUndo = useCallback(() => {
    const n = undo.current.pop();
    if (!n) return;
    redo.current.push(live.current);
    live.current = n;
    onChange?.(n);
    tickHist();
  }, [onChange]);

  const doRedo = useCallback(() => {
    const n = redo.current.pop();
    if (!n) return;
    undo.current.push(live.current);
    live.current = n;
    onChange?.(n);
    tickHist();
  }, [onChange]);

  const replaceKind = useCallback(
    <T extends AnnObj>(kind: T["kind"], next: T[], undoable = true) => {
      const keep = live.current.filter((o) => o.kind !== kind);
      commit([...keep, ...next], undoable !== false);
    },
    [commit],
  );

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        spacePan.current = true;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spacePan.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [doUndo, doRedo]);

  const panning = tool === "move" || locked || spacePan.current;
  const drawing = !panning && (tool === "box" || tool === "polygon");

  const hands = objects.filter((o): o is HandObj => o.kind === "hand");
  const boxes = objects.filter((o): o is BoxObj => o.kind === "box");
  const polys = objects.filter((o): o is PolyObj => o.kind === "polygon");

  return (
    <>
      <main
        className={drawing ? "cross" : undefined}
        onPointerDown={(e: PE<HTMLElement>) => {
          if (!panning && drawing) return;
          if (!panning && tool === "landmarks") {
            onEdit?.(null);
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
        <div className="world" style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom / 100})` }}>
          <div className="dots" aria-hidden="true" />
          <div className="frame" ref={frame}>
            <i />
            <i />
            <i />
            <i />
            <img
              src={src}
              alt={alt}
              draggable={false}
              width={1280}
              height={720}
              className={imgReady ? "ready" : undefined}
            />
            {imgReady && (projectType === "boxes" || boxes.length > 0) && (
              <Boxes
                objects={boxes}
                classes={classes}
                locked={locked || panning}
                active={tool === "box"}
                selectedId={selectedId}
                frameRef={frame}
                onChange={(next, u) => replaceKind("box", next, u)}
                onSelect={(id) => onSelect?.(id)}
                onEdit={(id) => onEdit?.(id)}
              />
            )}
            {imgReady && (projectType === "polygons" || polys.length > 0) && (
              <Polys
                objects={polys}
                classes={classes}
                locked={locked || panning}
                active={tool === "polygon"}
                selectedId={selectedId}
                frameRef={frame}
                onChange={(next, u) => replaceKind("polygon", next, u)}
                onSelect={(id) => onSelect?.(id)}
                onEdit={(id) => onEdit?.(id)}
              />
            )}
            {imgReady && (projectType === "hands" || hands.length > 0) && (
              <Hands
                objects={hands}
                classes={classes}
                locked={locked || tool === "move"}
                active={projectType === "hands" ? tool !== "move" : tool === "landmarks"}
                selectedId={selectedId}
                frameRef={frame}
                onChange={(next, u) => replaceKind("hand", next, u)}
                onSelect={(id) => onSelect?.(id)}
                onEdit={(id) => onEdit?.(id)}
              />
            )}
          </div>
        </div>
      </main>
      <div className="stack">
        <div className="panel tools" onMouseLeave={() => setTip(null)}>
          {TOOLS.filter((t) => shown.includes(t.id)).map((t) => (
            <Fragment key={t.id}>
              {t.id === "assist" && <hr />}
              <button
                type="button"
                className={t.id === "assist" ? "assist" : undefined}
                aria-label={t.id === "assist" && assistBusy ? "Assist running…" : t.label}
                aria-pressed={t.id === "assist" ? assistOn : tool === t.id || (t.id === "move" && tool === "move")}
                title={t.label}
                onMouseEnter={(e) => {
                  const stack = e.currentTarget.closest(".stack");
                  if (!(stack instanceof HTMLElement)) return;
                  const b = e.currentTarget.getBoundingClientRect();
                  const s = stack.getBoundingClientRect();
                  stack.style.setProperty("--tip-y", `${b.top + b.height / 2 - s.top}px`);
                  setTip(t.id === "assist" && assistBusy ? "Assist running…" : t.label);
                }}
                onFocus={(e) => {
                  const stack = e.currentTarget.closest(".stack");
                  if (!(stack instanceof HTMLElement)) return;
                  const b = e.currentTarget.getBoundingClientRect();
                  const s = stack.getBoundingClientRect();
                  stack.style.setProperty("--tip-y", `${b.top + b.height / 2 - s.top}px`);
                  setTip(t.label);
                }}
                onBlur={() => setTip(null)}
                onClick={() => {
                  if (t.id === "assist") onAssistOn?.();
                  else if (t.id === "move") setTool(tool === "move" ? DEFAULT_TOOL[projectType] : "move");
                  else setTool(t.id);
                }}
              >
                <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
                  <path d={t.d} fill="currentColor" />
                </svg>
              </button>
              {t.id === "move" && (
                <>
                  <button
                    type="button"
                    disabled={hist.u === 0}
                    aria-label="Undo"
                    title="Undo (⌘Z)"
                    onMouseEnter={(e) => {
                      const stack = e.currentTarget.closest(".stack");
                      if (!(stack instanceof HTMLElement)) return;
                      const b = e.currentTarget.getBoundingClientRect();
                      const s = stack.getBoundingClientRect();
                      stack.style.setProperty("--tip-y", `${b.top + b.height / 2 - s.top}px`);
                      setTip("Undo (⌘Z)");
                    }}
                    onMouseLeave={() => setTip(null)}
                    onClick={doUndo}
                  >
                    <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
                      <path
                        d="M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L60.63,81.29l17,17A8,8,0,0,1,72,112H24a8,8,0,0,1-8-8V56A8,8,0,0,1,29.66,50.3L49.31,70,60.25,60A96,96,0,0,1,224,128Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    disabled={hist.r === 0}
                    aria-label="Redo"
                    title="Redo (⇧⌘Z)"
                    onMouseEnter={(e) => {
                      const stack = e.currentTarget.closest(".stack");
                      if (!(stack instanceof HTMLElement)) return;
                      const b = e.currentTarget.getBoundingClientRect();
                      const s = stack.getBoundingClientRect();
                      stack.style.setProperty("--tip-y", `${b.top + b.height / 2 - s.top}px`);
                      setTip("Redo (⇧⌘Z)");
                    }}
                    onMouseLeave={() => setTip(null)}
                    onClick={doRedo}
                  >
                    <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
                      <path
                        d="M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1-5.66-13.66l17-17-10.55-9.65-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,1,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60l10.93,10L226.34,50.3A8,8,0,0,1,240,56Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </>
              )}
            </Fragment>
          ))}
        </div>
        {tip && <span className="tip">{tip}</span>}
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
          <span className="nums">{zoom}%</span>
          <button
            type="button"
            className="step"
            disabled={locked || zoom >= MAX}
            onClick={() => setZoom((z) => Math.min(MAX, z + STEP))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button type="button" aria-label="Lock canvas" aria-pressed={locked} onClick={() => setLocked((v) => !v)}>
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
