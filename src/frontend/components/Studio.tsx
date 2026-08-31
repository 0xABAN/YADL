"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Canvas from "./Canvas";
import Classes from "./Classes";
import Footer from "./Footer";
import { SHOWN, classColor, named, type Doc, type HandObj, type Project } from "@/lib/doc";

const api = (path: string) =>
  fetch(`/api${path}`).then((r) => {
    if (r.status === 401) {
      location.href = "/auth";
      return Promise.reject();
    }
    return r.json();
  });

export default function Studio({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [list, setList] = useState<{ id: string; filename: string; committed?: boolean }[]>([]);
  const [index, setIndex] = useState(0);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [histPos, setHistPos] = useState<{ x: number; y: number } | null>(null);
  const histRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [assistOn, setAssistOn] = useState(true);
  const assistOnRef = useRef(true);
  assistOnRef.current = assistOn;

  useEffect(() => {
    Promise.all([api(`/projects/${id}`), api(`/projects/${id}/images`)]).then(([p, imgs]) => {
      setProject(p);
      setList(Array.isArray(imgs) ? imgs : []);
    });
  }, [id]);

  useEffect(() => {
    if (!assistOnRef.current || !list.length) return;
    fetch(`/api/projects/${id}/assist`, { method: "POST" });
  }, [id, list]);

  const apply = (d: Doc) => {
    const objects = (d.objects ?? []).filter((o) => o.kind === "hand") as HandObj[];
    setDoc({ ...d, objects });
    setSelected(objects[0]?.id ?? null);
  };

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

  const iid = list[index]?.id;
  useEffect(() => {
    if (!iid) {
      setDoc(null);
      return;
    }
    setEdit(null);
    setHistOpen(false);
    const ac = new AbortController();
    fetch(`/api/projects/${id}/images/${iid}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => {
        if (ac.signal.aborted) return;
        apply(d);
        if (!assistOnRef.current || (d.objects ?? []).length) return;
        return fetch(`/api/projects/${id}/images/${iid}/assist`, { method: "POST", signal: ac.signal })
          .then((r) => r.json())
          .then((d2) => {
            if (ac.signal.aborted) return;
            apply(d2);
          });
      })
      .catch(() => {});
    return () => ac.abort();
  }, [id, iid]);

  const save = (objects: HandObj[]) => {
    if (!doc) return;
    const next = { ...doc, objects };
    setDoc(next);
    fetch(`/api/projects/${id}/images/${doc.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  };

  const hands = doc?.objects ?? [];
  const editing = edit && edit !== "new" ? hands.find((o) => o.id === edit) : undefined;
  const classes = (project?.classes ?? []).filter((c) => named(c));
  const q = draft.trim();
  const shown = q ? classes.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : classes;
  const fresh = q.length > 0 && !classes.some((c) => c.toLowerCase() === q.toLowerCase());

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
    if (editing) save(hands.map((o) => (o.id === editing.id ? { ...o, label } : o)));
    setEdit(null);
  };

  return (
    <div className="shell">
      <Classes
        classes={classes}
        objects={hands}
        selected={selected}
        onSelect={setSelected}
        onLabel={(label) => {
          if (!selected) return;
          save(hands.map((o) => (o.id === selected ? { ...o, label } : o)));
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
      {doc?.url && (
        <Canvas
          src={doc.url}
          objects={hands}
          shown={SHOWN[project?.type ?? "hands"]}
          classes={classes}
          onChange={save}
          assistOn={assistOn}
          onAssistOn={() => {
            const next = !assistOn;
            setAssistOn(next);
            if (!next) return;
            fetch(`/api/projects/${id}/assist`, { method: "POST" });
            if (!doc || hands.length) return;
            fetch(`/api/projects/${id}/images/${doc.id}/assist`, { method: "POST" })
              .then((r) => r.json())
              .then(apply);
          }}
          onEdit={(id) => {
            setEdit(id);
            if (id) {
              setSelected(id);
              setDraft(named(hands.find((o) => o.id === id)?.label ?? null) ?? "");
            }
          }}
        />
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
            <input
              autoFocus
              value={draft}
              placeholder="label"
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="button" aria-label="close" onClick={() => setEdit(null)}>×</button>
          </header>
          <div className="ann-btns">
            <button type="submit" className="save">Save</button>
            <button
              type="button"
              className="del"
              onClick={() => {
                if (editing) save(hands.filter((o) => o.id !== editing.id));
                setEdit(null);
              }}
            >
              Delete
            </button>
          </div>
          {shown.length === 0 && !fresh ? (
            <p className="empty">no existing labels</p>
          ) : (
            <ul>
              {shown.map((name) => (
                <li
                  key={name}
                  aria-current={q.toLowerCase() === name.toLowerCase() || undefined}
                  style={{ "--cc": classColor(name, classes) } as CSSProperties}
                  onClick={() => stamp(name)}
                >
                  <span className="swatch" />
                  {name}
                </li>
              ))}
              {fresh && <li aria-current onClick={() => stamp(q)}>create {q}</li>}
            </ul>
          )}
        </form>
      )}
      <Footer
        path={doc && project ? `${project.name}/${doc.image}` : ""}
        index={index}
        n={list.length}
        onPrev={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(list.length - 1, i + 1))}
        onCommit={async () => {
          if (!doc || !hands.some((o) => named(o.label))) return;
          const first = !doc.committed;
          const r = await fetch(`/api/projects/${id}/images/${doc.id}/commit`, { method: "POST" });
          if (!r.ok) return;
          const d = await r.json();
          setDoc({ ...doc, committed: true, history: d.history ?? doc.history });
          setList((ls) => ls.map((x) => (x.id === doc.id ? { ...x, committed: true } : x)));
          if (first) setIndex((i) => Math.min(i + 1, list.length - 1));
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
        committed={!!doc?.committed}
        canCommit={hands.some((o) => named(o.label))}
        nCommitted={list.filter((x) => x.committed).length}
        histOpen={histOpen}
      />
      {histOpen && histPos && (
        <div className="hist" data-hist ref={histRef} style={{ left: histPos.x, top: histPos.y }}>
          <header>
            <h2>History</h2>
            <button type="button" aria-label="close" onClick={() => setHistOpen(false)}>
              ×
            </button>
          </header>
          {(doc?.history ?? []).length === 0 ? (
            <p className="empty">No versions</p>
          ) : (
            <ul>
              {[...(doc?.history ?? [])].reverse().map((v) => (
                <li
                  key={v.id}
                  onClick={() => {
                    save((v.objects ?? []).filter((o) => o.kind === "hand"));
                    setHistOpen(false);
                  }}
                >
                  {v.id}
                  {v.at && <time dateTime={v.at}>{new Date(v.at).toLocaleString()}</time>}
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
    </div>
  );
}
