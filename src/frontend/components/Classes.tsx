"use client";

import { useState } from "react";
import Grainient from "./Grainient";
import { REGION_COLOR } from "@/lib/hand";

const LABELS = [
  { name: "wrist", color: REGION_COLOR.wrist, n: 1 },
  { name: "joint", color: REGION_COLOR.joint, n: 15 },
  { name: "tip", color: REGION_COLOR.tip, n: 5 },
];

export default function Classes() {
  const [tab, setTab] = useState<"labels" | "objects">("labels");
  return (
    <aside>
      <Grainient
        color1="#99edff"
        color2="#bfff00"
        color3="#99edff"
        timeSpeed={0.4}
        colorBalance={0}
        warpStrength={1}
        warpFrequency={5.5}
        warpSpeed={2.2}
        warpAmplitude={50}
        blendAngle={0}
        blendSoftness={0.05}
        rotationAmount={520}
        noiseScale={4}
        grainAmount={0.1}
        grainScale={2}
        grainAnimated={false}
        contrast={1.5}
        gamma={1}
        saturation={1}
        centerX={0.06}
        centerY={0}
        zoom={1}
      />
      <div className="rail-ui">
        <span className="brand">YADL+</span>
        <p className="lede">Most tools augment humans with AI. This one augments AI with humans.</p>
        <nav className="tabs">
          <button type="button" aria-pressed={tab === "labels"} onClick={() => setTab("labels")}>Labels</button>
          <button type="button" aria-pressed={tab === "objects"} onClick={() => setTab("objects")}>Objects</button>
        </nav>
        <div className="pane">
          {tab === "labels" && (
            <ul className="labels">
              {LABELS.map((l) => (
                <li key={l.name}>
                  <span className="swatch" style={{ background: l.color }} />
                  {l.name}
                  <b>{l.n}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
