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
  const [list, setList] = useState<{ id: string; filename: string }[]>([]);
  const [index, setIndex] = useState(0);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [assistOn, setAssistOn] = useState(true);
  const assistOnRef = useRef(true);
  assistOnRef.current = assistOn;

  useEffect(() => {
    Promise.all([api(`/projects/${id}`), api(`/projects/${id}/images`)]).then(([p, imgs]) => {
      setProject(p);
      setList(Array.isArray(imgs) ? imgs : []);
    });
  }, [id]);

  const apply = (d: Doc) => {
    const objects = (d.objects ?? []).filter((o) => o.kind === "hand") as HandObj[];
    setDoc({ ...d, objects });
    setSelected(objects[0]?.id ?? null);
  };

  const iid = list[index]?.id;
  useEffect(() => {
    if (!iid) {
      setDoc(null);
      return;
    }
    setEdit(null);
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
  const editing = hands.find((o) => o.id === edit);
  const classes = (project?.classes ?? []).filter((c) => named(c));
  const q = draft.trim();
  const shown = q ? classes.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : classes;
  const fresh = q.length > 0 && !classes.some((c) => c.toLowerCase() === q.toLowerCase());

  const stamp = async (name: string) => {
    const label = name.trim();
    if (!label || !editing || !project) return;
    if (!project.classes.includes(label)) {
      const r = await fetch(`/api/projects/${id}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: label }),
      });
      if (r.ok) setProject(await r.json());
      else setProject({ ...project, classes: [...project.classes, label] });
    }
    save(hands.map((o) => (o.id === editing.id ? { ...o, label } : o)));
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
            if (!next || !doc || hands.length) return;
            fetch(`/api/projects/${id}/images/${doc.id}/assist`, { method: "POST" })
              .then((r) => r.json())
              .then((d) => {
                apply(d);
              });
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
      {editing && (
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
              placeholder="class"
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
                save(hands.filter((o) => o.id !== editing.id));
                setEdit(null);
              }}
            >
              Delete
            </button>
          </div>
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
        </form>
      )}
      <Footer
        path={doc ? `/${doc.image}` : ""}
        index={index}
        n={list.length}
        onPrev={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(list.length - 1, i + 1))}
      />
    </div>
  );
}
