"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/doc";

const TYPES = [
  { id: "boxes", name: "Bounding boxes", blurb: "Identify objects and their positions with bounding boxes." },
  { id: "polygons", name: "Polygons", blurb: "Detect objects and their actual shape." },
  { id: "hands", name: "Landmarks", blurb: "Identify keypoints on subjects." },
] as const;

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("boxes");
  const [vis, setVis] = useState<"Private" | "Public">("Private");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Project[]>([]);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((d) => setRows(Array.isArray(d) ? d : []));
  }, []);

  const create = () => {
    if (!name.trim()) {
      setErr(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), type }),
    })
      .then((r) => r.json())
      .then((p) => router.push(`/p/${p.id}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className="create">
      <header>
        <a className="word" href="/">YADL+</a>
      </header>
      <div className="body">
        <h1>Let's create your project.</h1>
        <p className="crumb">
          dev
          <span>›</span>
          <em>{vis}</em>
        </p>
        <div className="fields">
          <label>
            Project name
            <input
              type="text"
              value={name}
              placeholder="E.g., 'Dog Breeds' or 'Car Models' or 'Text Finder'."
              onChange={(e) => {
                setName(e.target.value);
                if (err) setErr(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            {err && <small className="err">Name cannot be empty.</small>}
          </label>
          <div>
            <p className="k">Visibility</p>
            <div className="vis">
              <button type="button" aria-pressed={vis === "Private"} onClick={() => setVis("Private")}>
                <svg viewBox="0 0 256 256" width="14" height="14" aria-hidden="true"><path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96Z" fill="currentColor" /></svg>
                Private
              </button>
              <button type="button" aria-pressed={vis === "Public"} onClick={() => setVis("Public")}>
                <svg viewBox="0 0 256 256" width="14" height="14" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H170.87a140.36,140.36,0,0,0,0-48h41.8A87.61,87.61,0,0,1,216,128ZM128,40a87.61,87.61,0,0,1,24,3.33V85.13a140.36,140.36,0,0,0-48,0V43.33A87.61,87.61,0,0,1,128,40ZM40,128a87.61,87.61,0,0,1,3.33-24h41.8a140.36,140.36,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128Zm88,88a87.61,87.61,0,0,1-24-3.33V170.87a140.36,140.36,0,0,0,48,0v41.8A87.61,87.61,0,0,1,128,216Z" fill="currentColor" /></svg>
                Public
              </button>
            </div>
          </div>
        </div>
        <p className="k">Project type</p>
        <div className="split">
          <div className="types">
            {TYPES.map((t) => (
              <button key={t.id} type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                <b>{t.name}</b>
                <span>{t.blurb}</span>
              </button>
            ))}
          </div>
          <div className="history">
            <h2>Project history</h2>
            {rows.length === 0 ? (
              <p className="empty">No projects yet.</p>
            ) : (
              rows.map((p) => (
                <a key={p.id} href={`/p/${p.id}`}>
                  {p.name}
                  <small>{p.type}</small>
                </a>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="bar">
        <button className="commit" type="button" disabled={busy} onClick={create}>
          Create {vis} Project
        </button>
      </div>
    </div>
  );
}
