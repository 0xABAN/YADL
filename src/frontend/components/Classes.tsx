"use client";

import { useRef, useState } from "react";
import Grainient from "./Grainient";
import { HAND_COLOR } from "@/lib/hand";
import { classColor, named, type HandObj } from "@/lib/doc";

export default function Classes({
  classes,
  objects,
  selected,
  onSelect,
  onLabel,
  onRename,
  onDrop,
}: {
  classes: string[];
  objects: HandObj[];
  selected: string | null;
  onSelect: (id: string) => void;
  onLabel: (label: string) => void;
  onRename: (old: string, name: string) => void;
  onDrop: (name: string) => void;
}) {
  const [tab, setTab] = useState<"labels" | "objects">("labels");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState("");
  const keep = useRef(true);
  const counts = Object.fromEntries(classes.map((c) => [c, objects.filter((o) => o.label === c).length]));
  return (
    <aside>
      <Grainient
        color1={HAND_COLOR[0]}
        color2={HAND_COLOR[1]}
        color3={HAND_COLOR[0]}
        timeSpeed={0.4}
        warpFrequency={5.5}
        warpSpeed={2.2}
        rotationAmount={520}
        noiseScale={4}
        centerX={0.06}
        zoom={1}
      />
      <div className="rail-ui">
        <span className="brand">yadl.</span>
        <p className="lede">yet another data labeler, but in this one, you don't have to click.</p>
        <nav className="tabs">
          <button type="button" aria-pressed={tab === "labels"} onClick={() => setTab("labels")}>Labels</button>
          <button type="button" aria-pressed={tab === "objects"} onClick={() => setTab("objects")}>Objects</button>
        </nav>
        <div className="pane">
          {tab === "labels" && (
            <ul className="labels poses">
              {classes.map((name) => (
                <li key={name} onClick={() => onLabel(name)}>
                  <span className="swatch" style={{ background: classColor(name, classes) }} />
                  {renaming === name ? (
                    <input
                      autoFocus
                      value={text}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setText(e.target.value)}
                      onBlur={() => {
                        if (keep.current) onRename(name, text);
                        keep.current = true;
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          keep.current = false;
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenaming(name);
                        setText(name);
                      }}
                    >
                      {name}
                    </span>
                  )}
                  <b>{counts[name] || 0}</b>
                  <button
                    type="button"
                    className="kill"
                    aria-label={`delete ${name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDrop(name);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tab === "objects" && (
            <ul className="labels">
              {objects.map((o, i) => (
                <li key={o.id} aria-current={selected === o.id || undefined} onClick={() => onSelect(o.id)}>
                  <span className="swatch" style={{ background: classColor(o.label, classes) }} />
                  Hand {i + 1}{named(o.label) ? ` · ${named(o.label)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
