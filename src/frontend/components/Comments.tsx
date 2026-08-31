"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { parseBody, tokenFor, type Comment } from "@/lib/comment";
import { classColor, objTitle, type AnnObj } from "@/lib/doc";

type Chunk = { t: "text"; v: string } | { t: "m"; id: string };

function Body({
  body,
  objects,
  classes,
  onMention,
}: {
  body: string;
  objects: AnnObj[];
  classes: string[];
  onMention?: (id: string) => void;
}) {
  const parts = useMemo(() => parseBody(body, objects, classes), [body, objects, classes]);
  return (
    <span className="cmt-body">
      {parts.map((p, i) =>
        p.type === "text" ? (
          <span key={i}>{p.value}</span>
        ) : (
          <button
            key={i}
            type="button"
            className={`cmt-chip${p.missing ? " missing" : ""}`}
            style={{ color: p.color, ["--glow" as string]: p.color }}
            disabled={p.missing}
            onClick={() => onMention?.(p.id)}
          >
            @{p.title}
          </button>
        ),
      )}
    </span>
  );
}

function serialize(chunks: Chunk[]) {
  return chunks
    .map((c) => (c.t === "m" ? tokenFor(c.id) : c.v))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function titleOf(id: string, objects: AnnObj[]) {
  const o = objects.find((x) => x.id === id);
  return o ? objTitle(o, objects) : "deleted";
}

export default function Comments({
  open,
  pos,
  comments,
  objects,
  classes,
  selectedId,
  onClose,
  onAdd,
  onDelete,
  onSelect,
  relTime,
}: {
  open: boolean;
  pos: { x: number; y: number } | null;
  comments: Comment[];
  objects: AnnObj[];
  classes: string[];
  selectedId: string | null;
  onClose: () => void;
  onAdd: (body: string) => Promise<void>;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  relTime: (iso: string) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [parts, setParts] = useState<Chunk[]>([]);
  const [live, setLive] = useState("");
  const [at, setAt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);

  const ranked = useMemo(() => {
    if (!at) return [];
    const q = live.toLowerCase();
    const rows = objects.map((o) => {
      const title = objTitle(o, objects);
      const low = title.toLowerCase();
      const label = (o.label ?? "untitled").toLowerCase();
      return { o, title, low, label };
    });
    // Prefer prefix on full title (`thumbs-up#1`), then prefix on label (`thumbs-up`)
    const scored = rows
      .map((r) => {
        let score = -1;
        if (!q) score = r.o.id === selectedId ? 3 : 2;
        else if (r.low.startsWith(q)) score = 4;
        else if (r.label.startsWith(q)) score = 3;
        else if (r.low.includes(q)) score = 1;
        return { ...r, score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score || (a.o.id === selectedId ? -1 : b.o.id === selectedId ? 1 : a.title.localeCompare(b.title)));
    return scored.slice(0, 12);
  }, [at, live, objects, selectedId]);

  const suggestion = useMemo(() => {
    if (!at || !ranked.length) return null;
    const hit = ranked[Math.min(pick, ranked.length - 1)] ?? ranked[0];
    const title = hit.title;
    const ql = live.toLowerCase();
    // shell-style: ghost is only the unread suffix of a prefix match
    const rest = title.toLowerCase().startsWith(ql) ? title.slice(live.length) : "";
    return { id: hit.o.id, title, rest };
  }, [at, ranked, pick, live]);

  useEffect(() => {
    if (!open) {
      setParts([]);
      setLive("");
      setAt(false);
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      const panel = ref.current?.getBoundingClientRect();
      const btn = document.querySelector("[data-tip=comment]")?.getBoundingClientRect();
      if (!panel || !btn) return;
      const pad = 40;
      const left = Math.min(panel.left, btn.left) - pad;
      const right = Math.max(panel.right, btn.right) + pad;
      const top = Math.min(panel.top, btn.top) - pad;
      const bottom = Math.max(panel.bottom, btn.bottom) + pad;
      if (e.clientX < left || e.clientX > right || e.clientY < top || e.clientY > bottom) onClose();
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [open, onClose]);

  const rankKey = ranked.map((r) => r.o.id).join(",");
  useEffect(() => {
    setPick(0);
  }, [live, at, rankKey]);

  if (!open || !pos) return null;

  const accept = () => {
    if (!suggestion) return;
    setParts((p) => [...p, { t: "m", id: suggestion.id }]);
    setLive(" ");
    setAt(false);
    inputRef.current?.focus();
  };

  const bodyNow = () => {
    const tail: Chunk[] = at ? [{ t: "text", v: `@${live}` }] : live ? [{ t: "text", v: live }] : [];
    return serialize([...parts, ...tail]);
  };

  const submit = async () => {
    const body = bodyNow();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onAdd(body);
      setParts([]);
      setLive("");
      setAt(false);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onType = (v: string) => {
    if (at) {
      setLive(v);
      return;
    }
    const i = v.lastIndexOf("@");
    if (i >= 0 && !/\s/.test(v.slice(i + 1))) {
      const before = v.slice(0, i);
      if (before) setParts((p) => [...p, { t: "text", v: before }]);
      setAt(true);
      setLive(v.slice(i + 1));
      return;
    }
    setLive(v);
  };

  const list = [...comments].reverse();
  const ghost = suggestion?.rest ?? "";
  const hasPrefix = parts.length > 0 || at;

  return (
    <div className="hist comments" data-comments ref={ref} style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Comments">
      <header>
        <h2>Comments</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="cmt-compose">
        <div className="cmt-field chips" onClick={() => inputRef.current?.focus()}>
          {parts.map((c, i) =>
            c.t === "m" ? (
              <span
                key={`m-${i}-${c.id}`}
                className={`cmt-chip${objects.some((o) => o.id === c.id) ? "" : " missing"}`}
                style={
                  {
                    color: classColor(objects.find((o) => o.id === c.id)?.label, classes),
                    ["--glow" as string]: classColor(objects.find((o) => o.id === c.id)?.label, classes),
                  } as CSSProperties
                }
              >
                @{titleOf(c.id, objects)}
              </span>
            ) : (
              <span key={`t-${i}`} className="cmt-txt">
                {c.v}
              </span>
            ),
          )}
          {at && <span className="cmt-txt">@</span>}
          <span className="cmt-live">
            <span className="cmt-mirror" aria-hidden="true">
              <span>{live}</span>
              {at && suggestion && <span className="cmt-ghost">{ghost}</span>}
            </span>
            <input
              ref={inputRef}
              value={live}
              placeholder={hasPrefix ? "" : "Note for the agent… (@ to mention)"}
              spellCheck={false}
              disabled={busy}
              aria-autocomplete="inline"
              aria-label="New comment"
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (at && suggestion) {
                  if (e.key === "Tab" || (e.key === "ArrowRight" && e.currentTarget.selectionStart === live.length)) {
                    e.preventDefault();
                    accept();
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setPick((i) => (ranked.length ? (i + 1) % ranked.length : 0));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setPick((i) => (ranked.length ? (i - 1 + ranked.length) % ranked.length : 0));
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setAt(false);
                    setLive(`@${live}`);
                    return;
                  }
                  if (e.key === "Backspace" && live === "") {
                    e.preventDefault();
                    setAt(false);
                    return;
                  }
                } else if (e.key === "Backspace" && live === "" && parts.length) {
                  e.preventDefault();
                  setParts((p) => {
                    const out = [...p];
                    const last = out.pop();
                    if (!last) return out;
                    if (last.t === "text") {
                      setLive(last.v);
                      return out;
                    }
                    // popped mention — done
                    return out;
                  });
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === "Escape" && !at) onClose();
              }}
            />
          </span>
        </div>
      </div>
      {list.length > 0 && (
        <ul className="cmt-list">
          {list.map((c) => (
            <li key={c.id}>
              <div className="cmt-row">
                <Body body={c.body} objects={objects} classes={classes} onMention={onSelect} />
                <button type="button" className="cmt-del" aria-label="Delete comment" onClick={() => onDelete(c.id)}>
                  ×
                </button>
              </div>
              {c.at && <time dateTime={c.at}>{relTime(c.at)}</time>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
