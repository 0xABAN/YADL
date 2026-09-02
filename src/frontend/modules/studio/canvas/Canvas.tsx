"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch";
import {
  DEFAULT_TOOL,
  SHOWN,
  isKeypoint,
  type AnnObj,
  type BoxObj,
  type PolyObj,
  type Project,
  type ToolId,
} from "../geometry/doc";
import Hands from "./editors/Hands";
import Boxes from "./editors/Boxes";
import Polys from "./editors/Polys";

/** Fit = 100%. Zoom range and steps are relative to fit. */
const FIT_PAD = 0.88;
const MIN_FIT = 0.25; // 25% of fit
const MAX_FIT = 8; // 800% of fit
const WHEEL_FIT = 0.04; // ~4% of fit per wheel notch (smooth off)
const BTN_FIT = 0.12; // ~12% of fit per ± click
const FALLBACK_MIN = 0.05;
const FALLBACK_MAX = 8;

/** UI % relative to fit scale — fit is always 100%. */
const zoomPct = (scale: number, fit: number) =>
  Math.round((scale / Math.max(fit, 1e-6)) * 100);

function toolKey(type: Project["type"]) {
  return `yadl.tool.${type}`;
}

function readTool(type: Project["type"], fallback: ToolId): ToolId {
  try {
    const v = sessionStorage.getItem(toolKey(type));
    if (type === "keypoints" && v === "landmarks") return "landmarks";
    if (type === "boxes" && v === "box") return "box";
    if (type === "polygons" && v === "polygon") return "polygon";
  } catch {
    /* private mode */
  }
  return fallback;
}

function writeTool(type: Project["type"], t: ToolId) {
  try {
    sessionStorage.setItem(toolKey(type), t);
  } catch {
    /* private mode */
  }
}

const TOOLS = [
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
    label: "Auto Label",
    d: "M208,144a15.78,15.78,0,0,1-10.42,14.93l-51.65,19-19,51.64a15.92,15.92,0,0,1-29.88,0L78.07,177.9l-51.65-19a15.92,15.92,0,0,1,0-29.88l51.65-19L97.1,58.43a15.92,15.92,0,0,1,29.88,0l19,51.65,51.65,19A15.78,15.78,0,0,1,208,144ZM152.72,39a8,8,0,0,0,5.66-2.34l16-16a8,8,0,1,0-11.32-11.32l-16,16a8,8,0,0,0,5.66,13.66Zm80,80a8,8,0,0,0-5.66,2.34l-16,16a8,8,0,1,0,11.32,11.32l16-16A8,8,0,0,0,232.72,119ZM32.72,39l16-16A8,8,0,0,0,37.4,11.34l-16,16A8,8,0,0,0,32.72,39Zm16,176-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,1,0-11.32-11.32Z",
  },
  {
    id: "seed",
    label: "Landmarks Tool",
    d: "M48,64a8,8,0,0,1,8-8H72V40a8,8,0,0,1,16,0V56h16a8,8,0,0,1,0,16H88V88a8,8,0,0,1-16,0V72H56A8,8,0,0,1,48,64ZM184,192h-8v-8a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0v-8h8a8,8,0,0,0,0-16Zm56-48H224V128a8,8,0,0,0-16,0v16H192a8,8,0,0,0,0,16h16v16a8,8,0,0,0,16,0V160h16a8,8,0,0,0,0-16ZM219.31,80,80,219.31a16,16,0,0,1-22.62,0L36.68,198.63a16,16,0,0,1,0-22.63L176,36.69a16,16,0,0,1,22.63,0l20.68,20.68A16,16,0,0,1,219.31,80Zm-54.63,32L144,91.31l-96,96L68.68,208ZM208,68.69,187.31,48l-32,32L176,100.69Z",
  },
  {
    id: "synthetic",
    label: "Synthetic images",
    d: "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.25V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z",
  },
] as const;

export default function Canvas({
  src = "/default.jpg",
  alt = "Sample",
  objects = [],
  projectType = "keypoints",
  onChange,
  onAssistOn,
  onAssistReseed,
  assistOn = true,
  assistBusy = false,
  onComment,
  commentsOpen = false,
  commentCount = 0,
  onSynthetic,
  syntheticOpen = false,
  onEdit,
  onSelect,
  selectedId = null,
  classes = [],
  tool: toolProp,
  onTool,
  railOn = true,
  onToggleRail,
  onImageSize,
}: {
  src?: string;
  alt?: string;
  objects?: AnnObj[];
  projectType?: Project["type"];
  onChange?: (objects: AnnObj[]) => void;
  onAssistOn?: () => void;
  onAssistReseed?: () => void;
  assistOn?: boolean;
  assistBusy?: boolean;
  onComment?: (btn: HTMLElement) => void;
  commentsOpen?: boolean;
  commentCount?: number;
  onSynthetic?: (btn: HTMLElement) => void;
  syntheticOpen?: boolean;
  onEdit?: (id: string | null) => void;
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  classes?: string[];
  tool?: ToolId;
  onTool?: (t: ToolId) => void;
  railOn?: boolean;
  onToggleRail?: () => void;
  /** Natural pixel size after decode; null when src clears / unknown. */
  onImageSize?: (size: { w: number; h: number } | null) => void;
}) {
  const shown = SHOWN[projectType];
  const [zoom, setZoom] = useState(0);
  const [tool, setToolInner] = useState<ToolId>(() => toolProp ?? readTool(projectType, DEFAULT_TOOL[projectType]));
  const [scaleLim, setScaleLim] = useState({ min: FALLBACK_MIN, max: FALLBACK_MAX, wheel: 0.02, btn: 0.1 });
  const [tip, setTip] = useState<string | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const zpp = useRef<ReactZoomPanPinchContentRef | null>(null);
  const undo = useRef<AnnObj[][]>([]);
  const redo = useRef<AnnObj[][]>([]);
  const [hist, setHist] = useState({ u: 0, r: 0 });
  const live = useRef(objects);
  live.current = objects;
  const tickHist = () => setHist({ u: undo.current.length, r: redo.current.length });
  const onImageSizeRef = useRef(onImageSize);
  onImageSizeRef.current = onImageSize;

  useEffect(() => {
    onImageSizeRef.current?.(imgSize);
  }, [imgSize]);

  const fitScale = useRef<number | null>(null);
  /** User panned or zoomed — skip auto-refit on resize until Reset. */
  const viewDirty = useRef(false);
  const fitting = useRef(false);

  const setDotsPos = (x: number, y: number) => {
    const el = mainRef.current;
    if (!el) return;
    el.style.setProperty("--dots-x", `${x}px`);
    el.style.setProperty("--dots-y", `${y}px`);
  };

  /** Keep landmark chips ~constant screen size under pan-zoom (image is natural px). */
  const setViewScale = (scale: number) => {
    const el = frame.current;
    if (!el) return;
    el.style.setProperty("--view-scale", String(Math.max(scale, 1e-6)));
  };

  const fitView = useCallback(() => {
    const api = zpp.current;
    const main = mainRef.current;
    const size = imgSize;
    if (!api || !main || !size?.w || !size?.h) return;

    const mr = main.getBoundingClientRect();
    const pad =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail-pad")) || 12;
    const stack = document.querySelector(".shell .stack")?.getBoundingClientRect();
    const footer = document.querySelector(".shell footer")?.getBoundingClientRect();

    // main-local edges: gap past zoom stack, gap above footer, pad on top/right
    const left = (stack ? stack.right - mr.left : 0) + pad;
    const right = mr.width - pad;
    const top = pad;
    const bottom = (footer ? footer.top - mr.top : mr.height) - pad;
    const aw = Math.max(1, right - left);
    const ah = Math.max(1, bottom - top);

    const scale = Math.min(aw / size.w, ah / size.h) * FIT_PAD;
    // center in free space (past stack, above footer)
    const x = left + (aw - size.w * scale) / 2;
    const y = top + (ah - size.h * scale) / 2;

    fitScale.current = scale;
    viewDirty.current = false;
    fitting.current = true;
    setScaleLim({
      min: scale * MIN_FIT,
      max: scale * MAX_FIT,
      wheel: scale * WHEEL_FIT,
      btn: scale * BTN_FIT,
    });
    api.setTransform(x, y, scale, 0);
    setDotsPos(x, y);
    setViewScale(scale);
    // Hold through lib onTransform (can be async) so fit doesn't mark viewDirty.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitting.current = false;
      });
    });
    setZoom(100);
  }, [imgSize]);

  useEffect(() => {
    if (toolProp) setToolInner(toolProp);
  }, [toolProp]);

  useEffect(() => {
    const t = toolProp ?? readTool(projectType, DEFAULT_TOOL[projectType]);
    setToolInner(t);
    onTool?.(t);
  }, [projectType]); // eslint-disable-line react-hooks/exhaustive-deps -- only flip tool when project type changes

  useEffect(() => {
    undo.current = [];
    redo.current = [];
    setHist({ u: 0, r: 0 });
    setZoom(0);
    setImgSize(null);
  }, [src]);

  useEffect(() => {
    setImgReady(false);
    setImgSize(null);
    viewDirty.current = false;
    fitScale.current = null;
    if (!src) return;
    let dead = false;
    const im = new window.Image();
    const done = () => {
      if (dead) return;
      if (im.naturalWidth > 0) setImgSize({ w: im.naturalWidth, h: im.naturalHeight });
      else setImgReady(true); // error / empty — show shell anyway
    };
    im.onload = done;
    im.onerror = done;
    im.src = src;
    if (im.complete && im.naturalWidth > 0) done();
    return () => {
      dead = true;
    };
  }, [src]);

  // fit once size is known (before opacity); re-fit on resize unless user zoomed/panned away from 100%
  useEffect(() => {
    if (!imgSize) return;
    let alive = true;
    const run = () => {
      if (!alive) return;
      fitView();
      setImgReady(true);
    };
    const onResize = () => {
      if (!alive) return;
      // refit when still at default fit (or dirty flag never stuck true)
      if (!viewDirty.current) fitView();
    };
    const t = requestAnimationFrame(() => requestAnimationFrame(run));
    window.addEventListener("resize", onResize);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      const main = mainRef.current;
      if (main) ro.observe(main);
      // chrome can move independently of main size (grid reflow)
      for (const sel of [".shell .stack", ".shell footer", ".shell aside"]) {
        const el = document.querySelector(sel);
        if (el) ro.observe(el);
      }
    }
    return () => {
      alive = false;
      cancelAnimationFrame(t);
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [imgSize, fitView]);

  const setTool = (t: ToolId) => {
    setToolInner(t);
    writeTool(projectType, t);
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
    <T extends AnnObj>(kind: T["kind"] | "keypoints", next: T[], undoable = true) => {
      const keep =
        kind === "keypoints"
          ? live.current.filter((o) => !isKeypoint(o))
          : live.current.filter((o) => o.kind !== kind);
      commit([...keep, ...next], undoable !== false);
    },
    [commit],
  );

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [doUndo, doRedo]);

  // Draw tools own empty-image drag; pan is empty chrome / non-draw tools (excluded hit targets).
  const drawing = tool === "box" || tool === "polygon";

  const hands = objects.filter(isKeypoint);
  const boxes = objects.filter((o): o is BoxObj => o.kind === "box");
  const polys = objects.filter((o): o is PolyObj => o.kind === "polygon");

  const tipAt = (el: HTMLElement, text: string) => {
    const stack = el.closest(".stack");
    if (!(stack instanceof HTMLElement)) return;
    const b = el.getBoundingClientRect();
    const s = stack.getBoundingClientRect();
    stack.style.setProperty("--tip-y", `${b.top + b.height / 2 - s.top}px`);
    setTip(text);
  };

  return (
    <>
      <main
        ref={mainRef}
        className={drawing ? "cross" : undefined}
        onPointerDown={() => {
          if (drawing) return;
          if (tool === "landmarks") onEdit?.(null);
        }}
      >
        {/* full-bleed dots — pitch fixed; offset tracks pan */}
        <div className="dots" aria-hidden="true" />
        <TransformWrapper
          key={src}
          ref={zpp}
          minScale={scaleLim.min}
          maxScale={scaleLim.max}
          initialScale={1}
          limitToBounds
          centerZoomedOut
          disablePadding
          smooth={false}
          doubleClick={{ disabled: true }}
          zoomAnimation={{ disabled: true }}
          panning={{
            velocityDisabled: true,
            // Annotation hit targets + draw layers win over pan (window-level mousedown).
            excluded: [
              "boxes",
              "box",
              "h",
              "box-tab",
              "polys",
              "poly",
              "edge",
              "pv",
              "hand",
              "pt",
              "chip",
            ],
          }}
          wheel={{ step: scaleLim.wheel, excluded: ["panel", "tools", "zoom"] }}
          pinch={{ step: 5 }}
          onInit={fitView}
          onTransform={(_, s) => {
            setDotsPos(s.positionX, s.positionY);
            setViewScale(s.scale);
            const fit = fitScale.current ?? s.scale;
            setZoom(zoomPct(s.scale, fit));
            if (fitting.current || fitScale.current == null) return;
            // Any user pan/zoom locks the view against resize auto-fit.
            viewDirty.current = true;
          }}
        >
          <TransformComponent
            wrapperClass="zpp"
            contentClass="world"
            wrapperStyle={{ width: "100%", height: "100%" }}
            contentStyle={{ width: "max-content", height: "max-content" }}
          >
            <div className="frame" ref={frame}>
              <i />
              <i />
              <i />
              <i />
              {src ? (
                <img
                  ref={imgRef}
                  src={src}
                  alt={alt}
                  draggable={false}
                  width={imgSize?.w || undefined}
                  height={imgSize?.h || undefined}
                  className={imgReady ? "ready" : undefined}
                />
              ) : null}
              {imgReady && (projectType === "boxes" || boxes.length > 0) && (
                <Boxes
                  objects={boxes}
                  classes={classes}
                  locked={false}
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
                  locked={false}
                  active={tool === "polygon"}
                  selectedId={selectedId}
                  frameRef={frame}
                  onChange={(next, u) => replaceKind("polygon", next, u)}
                  onSelect={(id) => onSelect?.(id)}
                  onEdit={(id) => onEdit?.(id)}
                />
              )}
              {imgReady && projectType === "keypoints" && hands.length > 0 && (
                <Hands
                  objects={hands}
                  classes={classes}
                  locked={false}
                  canDrag
                  active
                  selectedId={selectedId}
                  frameRef={frame}
                  onChange={(next, u) => replaceKind("keypoints", next, u)}
                  onSelect={(id) => onSelect?.(id)}
                  onEdit={(id) => onEdit?.(id)}
                />
              )}
            </div>
          </TransformComponent>
        </TransformWrapper>
      </main>
      <div className="stack">
        {onToggleRail && (
          <div className="panel rail-tog" onMouseLeave={() => setTip(null)}>
            <button
              type="button"
              aria-label={railOn ? "Hide labels rail" : "Show labels rail"}
              title={railOn ? "Hide labels (⌘B)" : "Show labels (⌘B)"}
              onMouseEnter={(e) => tipAt(e.currentTarget, railOn ? "Hide labels" : "Show labels")}
              onFocus={(e) => tipAt(e.currentTarget, railOn ? "Hide labels" : "Show labels")}
              onBlur={() => setTip(null)}
              onClick={onToggleRail}
            >
              <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
                {railOn ? (
                  <path
                    d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"
                    fill="currentColor"
                  />
                ) : (
                  <path
                    d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"
                    fill="currentColor"
                  />
                )}
              </svg>
            </button>
          </div>
        )}
        <div className="panel tools" onMouseLeave={() => setTip(null)}>
          {shown
            .map((id) => TOOLS.find((t) => t.id === id))
            .filter((t): t is (typeof TOOLS)[number] => !!t)
            .map((t) => (
            <Fragment key={t.id}>
              {t.id === "seed" && <hr />}
              <button
                type="button"
                className={t.id === "assist" || t.id === "seed" || t.id === "synthetic" ? "assist" : undefined}
                data-tip={t.id === "synthetic" ? "synthetic-tool" : t.id === "seed" ? "seed-tool" : undefined}
                disabled={t.id === "seed" && (assistBusy || !src)}
                aria-label={
                  t.id === "assist" && assistBusy
                    ? "Auto Label running…"
                    : t.id === "seed" && assistBusy
                      ? "Detecting landmarks…"
                      : t.label
                }
                aria-pressed={
                  t.id === "assist"
                    ? assistOn
                    : t.id === "synthetic"
                      ? syntheticOpen
                      : t.id === "seed"
                        ? false
                        : tool === t.id
                }
                title={t.label}
                onMouseEnter={(e) =>
                  tipAt(
                    e.currentTarget,
                    assistBusy && (t.id === "assist" || t.id === "seed")
                      ? t.id === "seed"
                        ? "Detecting landmarks…"
                        : "Auto Label running…"
                      : t.label,
                  )
                }
                onFocus={(e) => tipAt(e.currentTarget, t.label)}
                onBlur={() => setTip(null)}
                onClick={(e) => {
                  if (t.id === "assist") onAssistOn?.();
                  else if (t.id === "seed") onAssistReseed?.();
                  else if (t.id === "synthetic") onSynthetic?.(e.currentTarget);
                  else setTool(t.id);
                }}
              >
                <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
                  <path d={t.d} fill="currentColor" />
                </svg>
              </button>
            </Fragment>
          ))}
          <hr />
          <button
            type="button"
            data-tip="comment-tool"
            aria-label="Comment (T)"
            aria-pressed={commentsOpen}
            title="Comment (T)"
            onMouseEnter={(e) =>
              tipAt(e.currentTarget, commentCount ? `Comment (T) · ${commentCount}` : "Comment (T)")
            }
            onMouseLeave={() => setTip(null)}
            onClick={(e) => onComment?.(e.currentTarget)}
          >
            <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
              <path
                d="M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            type="button"
            disabled={hist.u === 0}
            aria-label="Undo"
            title="Undo (⌘Z)"
            onMouseEnter={(e) => tipAt(e.currentTarget, "Undo (⌘Z)")}
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
            onMouseEnter={(e) => tipAt(e.currentTarget, "Redo (⇧⌘Z)")}
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
        </div>
        {tip && <span className="tip">{tip}</span>}
        <div className="panel zoom">
          <button
            type="button"
            className="step"
            disabled={zoom <= Math.round(MIN_FIT * 100)}
            onClick={() => zpp.current?.zoomOut(scaleLim.btn, 0)}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="nums">{zoom}%</span>
          <button
            type="button"
            className="step"
            disabled={zoom >= Math.round(MAX_FIT * 100)}
            onClick={() => zpp.current?.zoomIn(scaleLim.btn, 0)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button type="button" onClick={fitView}>
            RESET
          </button>
        </div>
      </div>
    </>
  );
}
