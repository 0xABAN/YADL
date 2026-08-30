"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/doc";

const EXAMPLES = [
  "faces", "hands", "dogs", "cats", "cars", "trucks", "buses", "bikes",
  "planes", "ships", "drones", "people", "crowds", "pedestrians", "cyclists",
  "animals", "birds", "fish", "sharks", "whales", "bees", "cattle", "horses",
  "wildlife", "weeds", "crops", "blight", "rust", "cracks", "leaks", "smoke",
  "flames", "floods", "potholes", "lane lines", "road signs", "stop signs",
  "plates", "helmets", "hard hats", "vests", "masks", "gloves", "seatbelts",
  "phones", "tumors", "lesions", "cells", "pills", "bones", "organs",
  "bacteria", "pollen", "flowers", "leaves", "fruit", "bruises", "mold",
  "pests", "mushrooms", "coral", "algae", "eggs", "nests", "tracks",
  "logos", "barcodes", "QR codes", "text", "handwriting", "receipts",
  "labels", "tickets", "passports", "graffiti", "defects", "dents",
  "scratches", "spills", "debris", "litter", "plastics", "oil spills",
  "clouds", "lightning", "aurora", "stars", "craters", "fossils", "gems",
  "coins", "stamps", "sneakers", "watches", "jewelry", "tools", "parts",
  "pallets", "forklifts", "parcels", "boxes", "shelves", "keypoints",
  "poses", "gestures", "blinks", "tattoos", "uniforms", "jerseys", "balls",
  "cones", "crosswalks", "bike lanes", "parking spots", "doors", "windows",
  "lights", "snow", "hail", "frost", "stumps", "knots", "tiles", "bricks",
  "cables", "chips", "wires", "meters", "gauges", "flares", "roofs",
  "tires", "brakes", "engines", "fabric", "stitches", "buttons", "zippers",
  "teeth", "cavities", "moles", "wounds", "burns", "vials", "colonies",
  "vessels", "nerves", "falls", "drowsiness", "queues", "desks", "chairs",
  "rooms", "trash", "players", "swings", "bins", "addresses", "seals",
  "toppings", "garnish", "allergens", "ripeness", "grapes", "apples",
  "tomatoes", "corn", "wheat", "rice", "trees", "logs", "ore", "dust",
  "solar panels", "damage", "wear", "syringes", "capsules", "retina",
  "emotions", "irises", "pupils", "eyes", "lips", "ASL signs",
  "yoga poses", "dance moves", "goal lines", "offside", "jersey numbers",
  "fill levels", "empty shelves", "price tags", "brand logos",
  "butterflies", "crop rows", "PCB faults", "weld beads", "solder gaps",
  "rust spots", "wind damage", "speed limits", "comic panels",
  "book spines", "wine labels", "album art", "latte art", "pizza",
  "sushi", "meat", "traffic cones", "fire hydrants", "streetlights",
  "power lines", "paw prints", "number plates", "smiles", "frowns",
  "fractures", "polyps", "nodules", "cataracts", "glaucoma",
  "misalignments", "missing parts", "loose bolts", "open valves",
  "products", "out of stock", "standing water", "bare soil",
  "deer", "bears", "foxes", "owls", "insects", "bats",
  "lane markings", "red lights", "mailboxes",
];

const TYPES = [
  { id: "boxes", name: "Bounding boxes", blurb: "Identify objects and their positions with bounding boxes." },
  { id: "polygons", name: "Polygons", blurb: "Detect objects and their actual shape." },
  { id: "hands", name: "Landmarks", blurb: "Identify keypoints on subjects." },
] as const;

export default function New() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["id"]>("boxes");
  const [vis, setVis] = useState<"Private" | "Public">("Private");
  const [err, setErr] = useState<"empty" | "taken" | null>(null);
  const [rows, setRows] = useState<Project[]>([]);
  const [ex, setEx] = useState(0);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((d) => setRows(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setEx((i) => (i + 1) % EXAMPLES.length), 2200);
    return () => clearInterval(t);
  }, []);

  const create = () => {
    const n = name.trim();
    if (!n) {
      setErr("empty");
      return;
    }
    if (rows.some((p) => p.name === n)) {
      setErr("taken");
      return;
    }
    router.push(`/upload?name=${encodeURIComponent(n)}&type=${type}`);
  };

  return (
    <div className="create">
      <h1>let's detect <span className="ex">{EXAMPLES[ex]}</span></h1>
      <div className="body">
        <div className="split">
        <div className="sheet">
          <div className="fields">
            <p className="k">Project name</p>
            <p className="k">Visibility</p>
            <input
              type="text"
              aria-label="Project name"
              value={name}
              placeholder="E.g., 'Dog Breeds'"
              onChange={(e) => {
                setName(e.target.value);
                if (err) setErr(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
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
            {err === "empty" && <small className="err">Name cannot be empty.</small>}
            {err === "taken" && <small className="err">Name already exists.</small>}
          </div>
          <div className="types">
            {TYPES.map((t) => (
              <button key={t.id} type="button" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                <b>{t.name}</b>
                <span>{t.blurb}</span>
              </button>
            ))}
          </div>
          <button className="commit" type="button" onClick={create}>
            Create {vis} Project
          </button>
        </div>
        <div className="history">
          <h2>Open</h2>
          {rows.length === 0 ? (
            <p className="empty">No projects yet.</p>
          ) : (
            rows.slice(0, 3).map((p) => (
              <a key={p.id} href={`/p/${p.id}`}>
                {p.name}
                <small>{p.type}</small>
              </a>
            ))
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
