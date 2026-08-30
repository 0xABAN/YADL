"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = ["boxes", "polygons", "hands"] as const;

export default function Upload() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("boxes");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<"taken" | "fail" | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const n = (q.get("name") || "").trim();
    const t = q.get("type");
    if (!n || !TYPES.includes(t as (typeof TYPES)[number])) {
      router.replace("/");
      return;
    }
    setName(n);
    setType(t as (typeof TYPES)[number]);
  }, [router]);

  const take = (list: FileList | File[]) => {
    setFiles([...list].filter((f) => f.type.startsWith("image/")));
  };

  const send = () => {
    if (!files.length || busy) return;
    setBusy(true);
    setErr(null);
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type }),
    })
      .then((r) => r.json().then((p) => ({ ok: r.ok, status: r.status, p })))
      .then(({ ok, status, p }) => {
        if (status === 409) {
          setErr("taken");
          return;
        }
        if (!ok || !p.id) {
          setErr("fail");
          return;
        }
        const body = new FormData();
        files.forEach((f) => body.append("files", f));
        return fetch(`/api/projects/${p.id}/images`, { method: "POST", body }).then((r) => {
          if (!r.ok) {
            fetch(`/api/projects/${p.id}`, { method: "DELETE" });
            setErr("fail");
            return;
          }
          router.push(`/p/${p.id}`);
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="create upload">
      <header>
        <a className="word" href="/">YADL+</a>
      </header>
      <div className="body">
        <h1>Upload data</h1>
        <p className="lede">{name ? `Project “${name}”. Images only.` : "Images only."}</p>
        {err === "taken" && <p className="err">Name already exists.</p>}
        {err === "fail" && <p className="err">Upload failed.</p>}
        <label
          className={over ? "drop over" : "drop"}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files);
          }}
        >
          <input type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && take(e.target.files)} />
          {files.length ? `${files.length} image${files.length === 1 ? "" : "s"} selected` : "Drop images here, or click to choose"}
        </label>
      </div>
      <div className="bar">
        <a href="/">Skip</a>
        <button className="commit" type="button" disabled={!files.length || busy} onClick={send}>
          Upload
        </button>
      </div>
    </div>
  );
}
