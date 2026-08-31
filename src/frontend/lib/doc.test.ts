import { readObjects, writeObjects, named, type AnnObj } from "./doc";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const poly: AnnObj = {
  id: "p1",
  kind: "polygon",
  label: "x",
  edited: true,
  geom: {
    t: "polygon",
    pts: [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.4 },
      { x: 0.5, y: 0.6 },
    ],
  },
};

const wire = writeObjects([poly]) as { geom: { pts: unknown[] } }[];
assert(Array.isArray(wire[0].geom.pts[0]), "pts are tuples on wire");
const back = readObjects(wire);
assert(back[0].kind === "polygon", "kind");
assert(back[0].kind === "polygon" && back[0].geom.pts[1].y === 0.4, "round-trip");
assert(named("untitled") === null, "untitled");
assert(named("open") === "open", "named");
console.log("doc.test.ts ok");
