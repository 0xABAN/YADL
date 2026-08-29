"use client";

import { useEffect, useState } from "react";
import Canvas from "./Canvas";
import Classes from "./Classes";
import Footer from "./Footer";
import type { Doc, HandObj, Project } from "@/lib/doc";

const api = (path: string) => fetch(`/api${path}`).then((r) => r.json());

export default function Studio() {
  const [project, setProject] = useState<Project | null>(null);
  const [list, setList] = useState<{ id: string; image: string }[]>([]);
  const [index, setIndex] = useState(0);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api("/project"), api("/images")]).then(([p, imgs]) => {
      setProject(p);
      setList(imgs);
    });
  }, []);

  const id = list[index]?.id;
  useEffect(() => {
    if (!id) return;
    api(`/images/${id}`).then((d: Doc) => {
      const objects = (d.objects ?? []).filter((o) => o.kind === "hand") as HandObj[];
      setDoc({ ...d, objects });
      setSelected(objects[0]?.id ?? null);
    });
  }, [id]);

  const save = (objects: HandObj[]) => {
    if (!doc) return;
    const next = { ...doc, objects };
    setDoc(next);
    fetch(`/api/images/${doc.id}`, {
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
      {doc && (
        <Canvas
          src={`/api/images/${doc.id}/file`}
          objects={hands}
          onChange={save}
          onAssist={() => {
            fetch(`/api/images/${doc.id}/assist`, { method: "POST" })
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
