"use client";

import { useState } from "react";
import Grainient from "./Grainient";
import { HAND_COLOR } from "@/lib/hand";
import type { HandObj } from "@/lib/doc";

export default function Classes({
  classes,
  objects,
  selected,
  onSelect,
  onLabel,
}: {
  classes: string[];
  objects: HandObj[];
  selected: string | null;
  onSelect: (id: string) => void;
  onLabel: (label: string) => void;
}) {
  const [tab, setTab] = useState<"labels" | "objects">("labels");
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
                  {name}
                  <b>{counts[name] || 0}</b>
                </li>
              ))}
            </ul>
          )}
          {tab === "objects" && (
            <ul className="labels">
              {objects.map((o, i) => (
                <li key={o.id} aria-current={selected === o.id || undefined} onClick={() => onSelect(o.id)}>
                  <span className="swatch" style={{ background: HAND_COLOR[i % HAND_COLOR.length] }} />
                  Hand {i + 1}{o.label ? ` · ${o.label}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
