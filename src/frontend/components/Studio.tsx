"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Canvas from "./Canvas";
import Classes from "./Classes";
import Footer from "./Footer";
import {
  classColor,
  named,
  readObjects,
  writeObjects,
  type AnnObj,
  type Doc,
  type Project,
  type ToolId,
} from "@/lib/doc";

const api = (path: string) =>
  fetch(`/api${path}`).then((r) => {
    if (r.status === 401) {
      location.href = "/auth";
      return Promise.reject();
    }
    return r.json();
  });

type ImgRow = { id: string; filename: string; committed?: boolean; empty?: boolean };

function relTime(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.round((t - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(sec, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86400), "day");
}

export default function Studio({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [project, setProject] = useState<Project | null>(null);
  const [list, setList] = useState<ImgRow[]>([]);
  const [index, setIndex] = useState(() => Math.max(0, Number(sp.get("i")) || 0));
  const [doc, setDoc] = useState<Doc | null>(null);
  const [selected, setSelected] = useState<string | null>(sp.get("obj"));
  const [tab, setTab] = useState<"labels" | "objects">(() => (sp.get("tab") === "objects" ? "objects" : "labels"));
  const [tool, setTool] = useState<ToolId | undefined>(undefined);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [histPos, setHistPos] = useState<{ x: number; y: number } | null>(null);
  const histRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [assistOn, setAssistOn] = useState(true);
  const assistOnRef = useRef(true);
  assistOnRef.current = assistOn;
  const [assistBusy, setAssistBusy] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [toast, setToast] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoToast = useRef<{ objects: AnnObj[]; t: ReturnType<typeof setTimeout> } | null>(null);

  // URL sync
  useEffect(() => {
    const q = new URLSearchParams();
    if (index > 0) q.set("i", String(index));
    if (tab !== "labels") q.set("tab", tab);
    if (selected) q.set("obj", selected);
    if (tool && tool !== "landmarks" && tool !== "box" && tool !== "polygon") q.set("tool", tool);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [index, tab, selected, tool, pathname, router]);

  useEffect(() => {
    setLoadState("loading");
    Promise.all([api(`/projects/${id}`), api(`/projects/${id}/images`)])
      .then(([p, imgs]) => {
        setProject(p);
        setList(Array.isArray(imgs) ? imgs : []);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, [id]);

  useEffect(() => {
    if (!assistOnRef.current || !list.length) return;
    setAssistBusy(true);
    fetch(`/api/projects/${id}/assist`, { method: "POST" })
      .catch(() => {})
      .finally(() => setAssistBusy(false));
  }, [id, list.length]);

  const apply = useCallback((d: Record<string, unknown>) => {
    const objects = readObjects(d.objects);
    setDoc({
      id: String(d.id),
      image: String(d.image ?? ""),
      url: (d.url as string | null) ?? null,
      committed: Boolean(d.committed),
      history: Array.isArray(d.history)
        ? (d.history as Doc["history"])?.map((h) => ({
            ...h,
            objects: readObjects(h.objects),
          }))
        : [],
      objects,
    });
    setSelected((cur) => (cur && objects.some((o) => o.id === cur) ? cur : objects[0]?.id ?? null));
  }, []);

  useEffect(() => {
    if (!histOpen) return;
    const onMove = (e: PointerEvent) => {
      const panel = histRef.current?.getBoundingClientRect();
      const btn = document.querySelector("[data-tip=history]")?.getBoundingClientRect();
      if (!panel || !btn) return;
      const pad = 40;
      const left = Math.min(panel.left, btn.left) - pad;
      const right = Math.max(panel.right, btn.right) + pad;
      const top = Math.min(panel.top, btn.top) - pad;
      const bottom = Math.max(panel.bottom, btn.bottom) + pad;
      if (e.clientX < left || e.clientX > right || e.clientY < top || e.clientY > bottom) setHistOpen(false);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [histOpen]);

  const iid = list[Math.min(index, Math.max(0, list.length - 1))]?.id;

  useEffect(() => {
    if (list.length && index >= list.length) setIndex(list.length - 1);
  }, [list.length, index]);

  useEffect(() => {
    if (!iid) {
      setDoc(null);
      return;
    }
    setEdit(null);
    setHistOpen(false);
    setSaveState("idle");
    const ac = new AbortController();
    fetch(`/api/projects/${id}/images/${iid}`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error("load");
        return r.json();
      })
      .then((d) => {
        if (ac.signal.aborted) return;
        apply(d);
        if (!assistOnRef.current || (d.objects ?? []).length) return;
        setAssistBusy(true);
        return fetch(`/api/projects/${id}/images/${iid}/assist`, { method: "POST", signal: ac.signal })
          .then((r) => r.json())
          .then((d2) => {
            if (ac.signal.aborted) return;
            apply(d2);
          })
          .finally(() => {
            if (!ac.signal.aborted) setAssistBusy(false);
          });
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setDoc(null);
      });
    return () => ac.abort();
  }, [id, iid, apply]);

  const save = useCallback(
    (objects: AnnObj[]) => {
      if (!doc) return;
      const next = { ...doc, objects };
      setDoc(next);
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      fetch(`/api/projects/${id}/images/${doc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, objects: writeObjects(objects) }),
      })
        .then((r) => {
          if (!r.ok) throw new Error("save");
          setSaveState("saved");
          saveTimer.current = setTimeout(() => setSaveState("idle"), 1200);
          setList((ls) =>
            ls.map((x) => (x.id === doc.id ? { ...x, empty: objects.length === 0 } : x)),
          );
        })
        .catch(() => setSaveState("error"));
    },
    [doc, id],
  );

  const objects = doc?.objects ?? [];
  const editing = edit && edit !== "new" ? objects.find((o) => o.id === edit) : undefined;
  const classes = (project?.classes ?? []).filter((c) => named(c));
  const q = draft.trim();
  const shown = q ? classes.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : classes;
  const fresh = q.length > 0 && !classes.some((c) => c.toLowerCase() === q.toLowerCase());
  const canCommit = objects.some((o) => named(o.label));
  const commitReason = objects.length === 0 ? "Add an object first" : "Name an object first";
  const nCommitted = list.filter((x) => x.committed).length;
  const nOpen = list.filter((x) => !x.committed).length;

  const stamp = async (name: string) => {
    const label = name.trim();
    if (!label || !project) return;
    if (!project.classes.includes(label)) {
      const r = await fetch(`/api/projects/${id}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: label }),
      });
      if (r.ok) setProject(await r.json());
      else setProject({ ...project, classes: [...project.classes, label] });
    }
    const target = editing?.id ?? selected;
    if (target) save(objects.map((o) => (o.id === target ? { ...o, label } : o)));
    setEdit(null);
  };

  // Keyboard labeling mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") {
        e.preventDefault();
        setIndex((i) => Math.min(list.length - 1, i + 1));
        return;
      }
      if (k === "k") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (k === "c" && canCommit) {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("footer [data-tip=commit]:not(:disabled)")?.click();
        return;
      }
      if (k === "e") {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("footer [data-tip=export]:not(:disabled)")?.click();
        return;
      }
      if (k === "l") {
        e.preventDefault();
        setDraft("");
        setEdit("new");
        return;
      }
      if (k === "n") {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("footer [data-tip=next-open]:not(:disabled)")?.click();
        return;
      }
      if (k === "h") {
        e.preventDefault();
        const btn = document.querySelector<HTMLElement>("[data-tip=history]");
        if (btn) btn.click();
        return;
      }
      if (k === "t") {
        e.preventDefault();
        setToast("Comment — coming soon");
        setTimeout(() => setToast(null), 1500);
        return;
      }
      if (k === "escape") {
        setEdit(null);
        setHistOpen(false);
        return;
      }
      if (/^[1-9]$/.test(e.key) && selected) {
        const cls = classes[Number(e.key) - 1];
        if (!cls) return;
        e.preventDefault();
        save(objects.map((o) => (o.id === selected ? { ...o, label: cls } : o)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list.length, canCommit, selected, objects, classes, save]);

  const railStatus = useMemo(() => {
    if (loadState === "loading") return "Loading project…";
    if (loadState === "error") return "Could not load project.";
    if (assistBusy) return "Assist running…";
    if (!list.length) return "No images — upload from Create.";
    if (doc && objects.length === 0) return "No objects on this image.";
    return undefined;
  }, [loadState, assistBusy, list.length, doc, objects.length]);

  return (
    <div className="shell">
      <a href="#studio-main" className="skip-in">
        Skip to canvas
      </a>
      <a href="/create" className="studio-back" aria-label="Back to projects">
        <svg viewBox="0 0 256 256" width="16" height="16" aria-hidden="true">
          <path
            d="M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z"
            fill="currentColor"
          />
        </svg>
      </a>
      <h1 className="sr-only">Studio{project ? ` — ${project.name}` : ""}</h1>
      <Classes
        classes={classes}
        objects={objects}
        selected={selected}
        tab={tab}
        onTab={setTab}
        status={railStatus}
        onSelect={setSelected}
        onLabel={(label) => {
          if (!selected) {
            setTab("objects");
            setToast("Select an object first");
            setTimeout(() => setToast(null), 1500);
            return;
          }
          save(objects.map((o) => (o.id === selected ? { ...o, label } : o)));
        }}
        onRename={async (old, name) => {
          const label = name.trim();
          if (!label || label === old) return;
          const r = await fetch(`/api/projects/${id}/classes`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ old, new: label }),
          });
          if (!r.ok) return;
          setProject(await r.json());
          if (doc) setDoc({ ...doc, objects: doc.objects.map((o) => (o.label === old ? { ...o, label } : o)) });
        }}
        onAdd={() => {
          setDraft("");
          setEdit("new");
        }}
        onDrop={async (name) => {
          if (!confirm(`Delete ${name}?`)) return;
          const r = await fetch(`/api/projects/${id}/classes`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          if (!r.ok) return;
          setProject(await r.json());
          if (doc) setDoc({ ...doc, objects: doc.objects.map((o) => (o.label === name ? { ...o, label: null } : o)) });
        }}
      />
      {doc?.url ? (
        <div id="studio-main">
          <Canvas
            src={doc.url}
            alt={doc.image || "Sample"}
            objects={objects}
            projectType={project?.type ?? "hands"}
            classes={classes}
            selectedId={selected}
            assistOn={assistOn}
            assistBusy={assistBusy}
            tool={tool}
            onTool={setTool}
            onChange={save}
            onSelect={setSelected}
            onAssistOn={() => {
              const next = !assistOn;
              setAssistOn(next);
              if (!next) return;
              setAssistBusy(true);
              fetch(`/api/projects/${id}/assist`, { method: "POST" })
                .catch(() => {})
                .finally(() => setAssistBusy(false));
              if (!doc || objects.length) return;
              fetch(`/api/projects/${id}/images/${doc.id}/assist`, { method: "POST" })
                .then((r) => r.json())
                .then(apply)
                .catch(() => {});
            }}
            onEdit={(oid) => {
              setEdit(oid);
              if (oid) {
                setSelected(oid);
                setDraft(named(objects.find((o) => o.id === oid)?.label) ?? "");
              }
            }}
          />
        </div>
      ) : (
        <main id="studio-main" className="empty-main">
          <p>
            {loadState === "loading"
              ? "Loading…"
              : loadState === "error"
                ? "Failed to load project."
                : list.length === 0
                  ? "No images in this project."
                  : "Loading image…"}
          </p>
        </main>
      )}
      {edit && (
        <form
          className="ann"
          onSubmit={(e) => {
            e.preventDefault();
            stamp(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEdit(null);
          }}
        >
          <header>
            <label className="sr-only" htmlFor="ann-label">
              Label
            </label>
            <input
              id="ann-label"
              name="label"
              autoComplete="off"
              spellCheck={false}
              autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer:fine)").matches}
              value={draft}
              placeholder="Label…"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="button" aria-label="Close" onClick={() => setEdit(null)}>
              ×
            </button>
          </header>
          <div className="ann-btns">
            <button type="submit" className="save">
              Save
            </button>
            <button
              type="button"
              className="del"
              onClick={() => {
                if (editing) save(objects.filter((o) => o.id !== editing.id));
                setEdit(null);
              }}
            >
              Delete
            </button>
          </div>
          {shown.length === 0 && !fresh ? (
            <p className="empty">No existing labels</p>
          ) : (
            <ul>
              {shown.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    aria-current={q.toLowerCase() === name.toLowerCase() || undefined}
                    style={{ "--cc": classColor(name, classes) } as CSSProperties}
                    onClick={() => stamp(name)}
                  >
                    <span className="swatch" aria-hidden="true" />
                    {name}
                  </button>
                </li>
              ))}
              {fresh && (
                <li>
                  <button type="button" aria-current onClick={() => stamp(q)}>
                    Create “{q}”
                  </button>
                </li>
              )}
            </ul>
          )}
        </form>
      )}
      <Footer
        path={doc && project ? `${project.name}/${doc.image}` : ""}
        index={list.length ? Math.min(index, list.length - 1) : 0}
        n={list.length}
        onPrev={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(list.length - 1, i + 1))}
        onNextOpen={() => {
          if (!list.length) return;
          for (let k = 1; k <= list.length; k++) {
            const j = (index + k) % list.length;
            if (!list[j].committed) {
              setIndex(j);
              return;
            }
          }
        }}
        onCommit={async () => {
          if (!doc || !canCommit) return;
          const first = !doc.committed;
          const prev = doc.objects;
          const r = await fetch(`/api/projects/${id}/images/${doc.id}/commit`, { method: "POST" });
          if (!r.ok) return;
          const d = await r.json();
          setDoc({
            ...doc,
            committed: true,
            history: Array.isArray(d.history)
              ? d.history.map((h: { id: string; objects: unknown; at?: string }) => ({
                  id: h.id,
                  at: h.at,
                  objects: readObjects(h.objects),
                }))
              : doc.history,
          });
          setList((ls) => ls.map((x) => (x.id === doc.id ? { ...x, committed: true } : x)));
          setToast(first ? "Committed" : "Updated — undo available");
          if (!first) {
            if (undoToast.current) clearTimeout(undoToast.current.t);
            undoToast.current = {
              objects: prev,
              t: setTimeout(() => {
                undoToast.current = null;
                setToast(null);
              }, 5000),
            };
          } else {
            setTimeout(() => setToast(null), 1200);
            setIndex((i) => Math.min(i + 1, list.length - 1));
          }
        }}
        onExport={() => {
          location.href = `/api/projects/${id}/export`;
        }}
        onHistory={(btn) => {
          setTip(null);
          if (histOpen) {
            setHistOpen(false);
            return;
          }
          const r = btn.getBoundingClientRect();
          const foot = btn.closest("footer")?.getBoundingClientRect();
          setHistPos({ x: r.left + r.width / 2, y: foot?.top ?? r.top });
          setHistOpen(true);
        }}
        onTip={setTip}
        canCommit={canCommit}
        commitReason={commitReason}
        nCommitted={nCommitted}
        nOpen={nOpen}
        histOpen={histOpen}
        saveState={saveState}
      />
      {histOpen && histPos && (
        <div className="hist" data-hist ref={histRef} style={{ left: histPos.x, top: histPos.y }} role="dialog" aria-label="History">
          <header>
            <h2>History</h2>
            <button type="button" aria-label="Close" onClick={() => setHistOpen(false)}>
              ×
            </button>
          </header>
          {(doc?.history ?? []).length === 0 ? (
            <p className="empty">No versions</p>
          ) : (
            <ul>
              {[...(doc?.history ?? [])].reverse().map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm("Restore this version? Current unsaved geometry will be replaced.")) return;
                      save(v.objects ?? []);
                      setHistOpen(false);
                    }}
                  >
                    <span className="hist-id">{v.id}</span>
                    {v.at && <time dateTime={v.at}>{relTime(v.at)}</time>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {tip && (
        <span className="tip" data-foot-tip style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </span>
      )}
      <div className="live" aria-live="polite">
        {toast}
        {toast?.includes("undo") && undoToast.current && (
          <>
            {" "}
            <button
              type="button"
              className="undo-link"
              onClick={() => {
                if (!undoToast.current) return;
                save(undoToast.current.objects);
                clearTimeout(undoToast.current.t);
                undoToast.current = null;
                setToast("Reverted");
                setTimeout(() => setToast(null), 1000);
              }}
            >
              Undo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
