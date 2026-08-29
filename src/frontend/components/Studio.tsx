"use client";

import { useEffect, useState } from "react";
import Canvas from "./Canvas";
import Classes from "./Classes";
import Footer from "./Footer";
import { SHOWN, type Doc, type HandObj, type Project } from "@/lib/doc";

const api = (path: string) => fetch(`/api${path}`).then((r) => r.json());

export default function Studio({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [list, setList] = useState<{ id: string; filename: string }[]>([]);
  const [index, setIndex] = useState(0);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api(`/projects/${id}`), api(`/projects/${id}/images`)]).then(([p, imgs]) => {
      setProject(p);
      setList(Array.isArray(imgs) ? imgs : []);
    });
  }, [id]);

  const iid = list[index]?.id;
  useEffect(() => {
    if (!iid) {
      setDoc(null);
      return;
    }
    api(`/projects/${id}/images/${iid}`).then((d: Doc) => {
      const objects = (d.objects ?? []).filter((o) => o.kind === "hand") as HandObj[];
      setDoc({ ...d, objects });
      setSelected(objects[0]?.id ?? null);
    });
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

  return (
    <div className="shell">
      <Classes
        classes={project?.classes ?? []}
        objects={hands}
        selected={selected}
        onSelect={setSelected}
        onLabel={(label) => {
          if (!selected) return;
          save(hands.map((o) => (o.id === selected ? { ...o, label } : o)));
        }}
      />
      {doc?.url && (
        <Canvas
          src={doc.url}
          objects={hands}
          shown={SHOWN[project?.type ?? "hands"]}
          onChange={save}
          onAssist={() => {
            fetch(`/api/projects/${id}/images/${doc.id}/assist`, { method: "POST" })
              .then((r) => r.json())
              .then((d: Doc) => {
                const objects = (d.objects ?? []).filter((o) => o.kind === "hand") as HandObj[];
                setDoc({ ...d, objects });
                setSelected(objects[0]?.id ?? selected);
              });
          }}
        />
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
