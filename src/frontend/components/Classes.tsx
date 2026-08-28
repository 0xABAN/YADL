"use client";

import { useState } from "react";
import Grainient from "./Grainient";
import { HAND_COLOR, NAMES, PRESETS } from "@/lib/hand";

const POSES = Object.keys(PRESETS);

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
            <ul className="labels poses">
              {POSES.map((id) => (
                <li key={id}>
                  {id.replaceAll("_", " ")}
                  <b>{id === "open" ? 1 : 0}</b>
                </li>
              ))}
            </ul>
          )}
          {tab === "objects" && (
            <ul className="labels">
              {HAND_COLOR.flatMap((color, h) =>
                NAMES.map((name, i) => (
                  <li key={`${h}-${i}`}>
                    <span className="swatch" style={{ background: color }} />
                    {i} {name}
                  </li>
                )),
              )}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
