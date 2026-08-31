"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Canvas from "./Canvas";
import Classes from "./Classes";
import Comments from "./Comments";
import Synthetic from "./Synthetic";
import Footer from "./Footer";
import { readComments } from "@/lib/comment";
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
    if (!r.ok) return Promise.reject(new Error(String(r.status)));
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
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsPos, setCommentsPos] = useState<{ x: number; y: number } | null>(null);
  const [commentsSide, setCommentsSide] = useState(false);
  const [synthOpen, setSynthOpen] = useState(false);
  const [synthPos, setSynthPos] = useState<{ x: number; y: number } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [assistOn, setAssistOn] = useState(true);
  const assistOnRef = useRef(true);
  assistOnRef.current = assistOn;
  const [assistBusy, setAssistBusy] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [toast, setToast] = useState<string | null>(null);
  const [toastOut, setToastOut] = useState(false);
  const toastHide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoToast = useRef<
    | { kind: "objects"; objects: AnnObj[]; t: ReturnType<typeof setTimeout> }
    | { kind: "image"; id: string; index: number; t: ReturnType<typeof setTimeout> }
    | null
  >(null);

  const showToast = useCallback((msg: string, holdMs?: number) => {
    if (toastHide.current) clearTimeout(toastHide.current);
    setToastOut(false);
    setToast(msg);
    if (holdMs != null) toastHide.current = setTimeout(() => setToastOut(true), holdMs);
  }, []);

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
        if (!p || typeof p !== "object" || !("id" in p)) throw new Error("project");
        if (!Array.isArray(imgs)) throw new Error("images");
        setProject(p);
        setList(imgs);
        setAssistOn(p.type === "hands");
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, [id]);

  useEffect(() => {
    if (!assistOnRef.current || !list.length || project?.type !== "hands") return;
    setAssistBusy(true);
    fetch(`/api/projects/${id}/assist`, { method: "POST" })
      .catch(() => {})
      .finally(() => setAssistBusy(false));
  }, [id, list.length, project?.type]);

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
      comments: readComments(d.comments),
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
    setCommentsOpen(false);
    setSynthOpen(false);

    const ac = new AbortController();
    fetch(`/api/projects/${id}/images/${iid}`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error("load");
        return r.json();
      })
      .then((d) => {
        if (ac.signal.aborted) return;
        apply(d);
        if (!assistOnRef.current || project?.type !== "hands" || (d.objects ?? []).length) return;
        setAssistBusy(true);
        return fetch(`/api/projects/${id}/images/${iid}/assist`, { method: "POST", signal: ac.signal })
          .then((r) => {
            if (!r.ok) throw new Error("assist");
            return r.json();
          })
          .then((d2) => {
            if (ac.signal.aborted) return;
            apply(d2);
            if (!(d2.objects ?? []).length) showToast("No hands detected", 1600);
          })
          .catch((e) => {
            if (e?.name === "AbortError") return;
            if (!ac.signal.aborted) showToast("Assist failed", 1500);
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
  }, [id, iid, apply, project?.type, showToast]);

  const save = useCallback(
    (objects: AnnObj[]) => {
      if (!doc) return;
      const next = { ...doc, objects };
      setDoc(next);
      fetch(`/api/projects/${id}/images/${doc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, objects: writeObjects(objects) }),
      })
        .then((r) => {
          if (!r.ok) throw new Error("save");
          setList((ls) =>
            ls.map((x) => (x.id === doc.id ? { ...x, empty: objects.length === 0 } : x)),
          );
        })
        .catch(() => {});
    },
    [doc, id],
  );

  const undoLast = useCallback(async () => {
    const u = undoToast.current;
    if (!u) return false;
    clearTimeout(u.t);
    undoToast.current = null;
    if (u.kind === "objects") {
      save(u.objects);
      showToast("Reverted", 1000);
      return true;
    }
    const r = await fetch(`/api/projects/${id}/images/${u.id}/restore`, { method: "POST" });
    if (!r.ok) {
      showToast("Restore failed", 1500);
      return true;
    }
    const item = (await r.json()) as ImgRow;
    setList((ls) => {
      if (ls.some((x) => x.id === item.id)) return ls;
      const next = [...ls];
      next.splice(Math.min(u.index, next.length), 0, item);
      return next;
    });
    setIndex(u.index);
    showToast("Restored", 1200);
    return true;
  }, [id, save, showToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (e.key.toLowerCase() !== "z") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!undoToast.current) return;
      e.preventDefault();
      e.stopPropagation();
      void undoLast();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [undoLast]);

  const objects = doc?.objects ?? [];
  const editing = edit && edit !== "new" ? objects.find((o) => o.id === edit) : undefined;
  const classes = (project?.classes ?? []).filter((c) => named(c));
  const q = draft.trim();
  const shown = q ? classes.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : classes;
  const fresh = q.length > 0 && !classes.some((c) => c.toLowerCase() === q.toLowerCase());
  const canCommit = objects.some((o) => named(o.label));
  const commitReason = objects.length === 0 ? "Add an object first" : "Name an object first";
  const nCommitted = list.filter((x) => x.committed).length;
  const idx = list.length ? Math.min(index, list.length - 1) : 0;
  // disabled when no *other* uncommitted image (current-only open is not "next")
  const canNextOpen = list.some((x, i) => !x.committed && i !== idx);

  const openNewLabel = useCallback(() => {
    setTip(null);
    setHistOpen(false);
    setCommentsOpen(false);
    setSynthOpen(false);
    setTab("labels");
    setDraft("");
    setEdit("new");
  }, []);

  const stamp = async (name: string) => {
    const label = name.trim();
    if (!label || !project) return;
    const creating = edit === "new";
    if (!project.classes.includes(label)) {
      setProject({ ...project, classes: [...project.classes, label] });
      const r = await fetch(`/api/projects/${id}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: label }),
      });
      if (r.ok) setProject(await r.json());
    }
    // L / Create label = class only. Assign only when editing a specific object.
    if (!creating) {
      const target = editing?.id ?? selected;
      if (target) save(objects.map((o) => (o.id === target ? { ...o, label } : o)));
    }
    setEdit(null);
    setTab("labels");
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
      if (k === "l" || e.code === "KeyL") {
        e.preventDefault();
        openNewLabel();
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
        const btn = document.querySelector<HTMLElement>("[data-tip=comment]");
        if (btn) btn.click();
        return;
      }
      if (k === "escape") {
        setEdit(null);
        setHistOpen(false);
        setCommentsOpen(false);
        setSynthOpen(false);
        return;
      }
      if ((k === "backspace" || k === "delete") && selected) {
        e.preventDefault();
        const next = objects.filter((o) => o.id !== selected);
        save(next);
        setSelected(next[0]?.id ?? null);
        setEdit(null);
        return;
      }
      if (/^[1-9]$/.test(e.key) && selected) {
        const cls = classes[Number(e.key) - 1];
        if (!cls) return;
        e.preventDefault();
        save(objects.map((o) => (o.id === selected ? { ...o, label: cls } : o)));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [list.length, canCommit, selected, objects, classes, save, openNewLabel]);

  const railStatus = useMemo(() => {
    if (loadState === "loading") return "Loading project…";
    if (loadState === "error") return "Could not load project.";
    if (assistBusy) return "Assist running…";
    return undefined;
  }, [loadState, assistBusy]);


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
      {loadState === "ready" && list.length > 0 && (
        <div
          className={`validity ${canCommit ? "ok" : "bad"}`}
          aria-live="polite"
        >
          {canCommit ? "Valid" : "Invalid"} annotation
        </div>
      )}
      <Classes
        classes={classes}
        objects={objects}
        selected={selected}
        tab={tab}
        onTab={setTab}
        status={railStatus}
        onSelect={(id) => {
          setSelected(id);
          setCommentsOpen(false);
          setHistOpen(false);
          setEdit(id);
          setDraft(""); // empty search → show every class
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
        onAdd={openNewLabel}
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
      {loadState === "ready" && list.length === 0 ? (
        <div id="studio-main">
          <Canvas
            src={undefined}
            alt="No images"
            objects={[]}
            projectType={project?.type ?? "hands"}
            classes={classes}
            selectedId={null}
            assistOn={assistOn}
            assistBusy={false}
            tool={tool}
            onTool={setTool}
            onChange={() => {}}
            onSelect={() => {}}
            onAssistOn={() => {
              if (project?.type === "hands") setAssistOn((v) => !v);
            }}
            commentsOpen={false}
            commentCount={0}
            syntheticOpen={false}
            onComment={() => {}}
            onSynthetic={() => {}}
            onEdit={() => {}}
          />
        </div>
      ) : doc?.url ? (
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
              if (project?.type !== "hands") return;
              const next = !assistOn;
              setAssistOn(next);
              if (!next) return;
              setAssistBusy(true);
              fetch(`/api/projects/${id}/assist`, { method: "POST" })
                .catch(() => {})
                .finally(() => setAssistBusy(false));
              if (!doc || objects.length) return;
              fetch(`/api/projects/${id}/images/${doc.id}/assist`, { method: "POST" })
                .then((r) => {
                  if (!r.ok) throw new Error("assist");
                  return r.json();
                })
                .then((d2) => {
                  apply(d2);
                  if (!(d2.objects ?? []).length) showToast("No hands detected", 1600);
                })
                .catch(() => showToast("Assist failed", 1500));
            }}
            commentsOpen={commentsOpen}
            commentCount={doc?.comments?.length ?? 0}
            syntheticOpen={synthOpen}
            onComment={(btn) => {
              setTip(null);
              setHistOpen(false);
              setSynthOpen(false);
              setEdit(null);
              if (commentsOpen) {
                setCommentsOpen(false);
                return;
              }
              const r = btn.getBoundingClientRect();
              setCommentsSide(true);
              setCommentsPos({ x: r.right + 12, y: r.top + r.height / 2 });
              setCommentsOpen(true);
            }}
            onSynthetic={(btn) => {
              setTip(null);
              setHistOpen(false);
              setCommentsOpen(false);
              setEdit(null);
              if (synthOpen) {
                setSynthOpen(false);
                return;
              }
              const r = btn.getBoundingClientRect();
              setSynthPos({ x: r.right + 12, y: r.top + r.height / 2 });
              setSynthOpen(true);
            }}
            onEdit={(oid) => {
              if (oid == null) {
                // don't dismiss in-progress create-label from a canvas click
                setEdit((cur) => (cur === "new" ? "new" : null));
                return;
              }
              setCommentsOpen(false);
              setHistOpen(false);
              setEdit(oid);
              setSelected(oid);
              setDraft(""); // empty search → show every class
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
              {edit === "new" ? "Create" : "Save"}
            </button>
            {edit !== "new" && (
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
            )}
          </div>
          {shown.length === 0 && !fresh ? (
            <p className="empty">No existing labels</p>
          ) : (
            <ul>
              {shown.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    aria-current={
                      (editing && named(editing.label)?.toLowerCase() === name.toLowerCase()) ||
                      q.toLowerCase() === name.toLowerCase()
                        ? true
                        : undefined
                    }
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
          if (!canNextOpen || !list.length) return;
          for (let k = 1; k < list.length; k++) {
            const j = (idx + k) % list.length;
            if (!list[j].committed) {
              setIndex(j);
              return;
            }
          }
        }}
        onDelete={async () => {
          if (!doc || !list.length) return;
          const iid = doc.id;
          const at = index;
          const r = await fetch(`/api/projects/${id}/images/${iid}`, { method: "DELETE" });
          if (!r.ok) return;
          const next = list.filter((x) => x.id !== iid);
          setList(next);
          setSelected(null);
          setEdit(null);
          setHistOpen(false);
          setCommentsOpen(false);
          if (next.length === 0) setDoc(null);
          setIndex(Math.min(at, Math.max(0, next.length - 1)));
          if (undoToast.current) clearTimeout(undoToast.current.t);
          showToast("Deleted");
          undoToast.current = {
            kind: "image",
            id: iid,
            index: at,
            t: setTimeout(() => {
              undoToast.current = null;
              setToastOut(true);
            }, 5000),
          };
        }}
        onCommit={async () => {
          if (!doc || !canCommit) return;
          const first = !doc.committed;
          const prev = doc.objects;
          const r = await fetch(`/api/projects/${id}/images/${doc.id}/commit`, { method: "POST" });
          if (!r.ok) {
            showToast("Commit failed", 1500);
            return;
          }
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
          if (!first) {
            if (undoToast.current) clearTimeout(undoToast.current.t);
            showToast("Updated");
            undoToast.current = {
              kind: "objects",
              objects: prev,
              t: setTimeout(() => {
                undoToast.current = null;
                setToastOut(true);
              }, 5000),
            };
          } else {
            showToast("Committed", 1200);
            setIndex((i) => Math.min(i + 1, list.length - 1));
          }
        }}
        onCopy={() => {
          if (!doc) return;
          const payload = {
            image: doc.image,
            id: doc.id,
            objects: writeObjects(doc.objects),
          };
          void navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(
            () => showToast("Copied", 1200),
            () => showToast("Copy failed", 1600),
          );
        }}
        onExport={() => {
          location.href = `/api/projects/${id}/export`;
        }}
        onHistory={(btn) => {
          setTip(null);
          setCommentsOpen(false);
          if (histOpen) {
            setHistOpen(false);
            return;
          }
          const r = btn.getBoundingClientRect();
          const foot = btn.closest("footer")?.getBoundingClientRect();
          setHistPos({ x: r.left + r.width / 2, y: foot?.top ?? r.top });
          setHistOpen(true);
        }}
        onComment={(btn) => {
          setTip(null);
          setHistOpen(false);
          setEdit(null);
          if (commentsOpen) {
            setCommentsOpen(false);
            return;
          }
          const r = btn.getBoundingClientRect();
          const foot = btn.closest("footer")?.getBoundingClientRect();
          setCommentsSide(false);
          setCommentsPos({ x: r.left + r.width / 2, y: foot?.top ?? r.top });
          setCommentsOpen(true);
        }}
        onTip={setTip}
        canCommit={canCommit}
        commitReason={commitReason}
        nCommitted={nCommitted}
        canNextOpen={canNextOpen}
        histOpen={histOpen}
        commentsOpen={commentsOpen}
        commentCount={doc?.comments?.length ?? 0}
      />
      <Synthetic open={synthOpen} pos={synthPos} onClose={() => setSynthOpen(false)} />
      <Comments
        open={commentsOpen}
        pos={commentsPos}
        side={commentsSide}
        comments={doc?.comments ?? []}
        objects={objects}
        classes={classes}
        selectedId={selected}
        onClose={() => setCommentsOpen(false)}
        onAdd={async (body) => {
          if (!doc) return;
          const r = await fetch(`/api/projects/${id}/images/${doc.id}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
          });
          if (!r.ok) return;
          apply(await r.json());
        }}
        onDelete={async (cid) => {
          if (!doc) return;
          const r = await fetch(`/api/projects/${id}/images/${doc.id}/comments/${cid}`, { method: "DELETE" });
          if (!r.ok) return;
          apply(await r.json());
        }}
        onSelect={(oid) => {
          setSelected(oid);
          setTab("objects");
        }}
        relTime={relTime}
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
      {toast && (
        <div
          className={`live${toastOut ? " out" : ""}`}
          aria-live="polite"
          onAnimationEnd={(e) => {
            if (e.animationName !== "live-out") return;
            setToast(null);
            setToastOut(false);
          }}
        >
          {toast}
          {(toast === "Updated" || toast === "Deleted") && undoToast.current && (
            <>
              {" "}
              <button
                type="button"
                className="undo-link"
                onClick={() => void undoLast()}
              >
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
