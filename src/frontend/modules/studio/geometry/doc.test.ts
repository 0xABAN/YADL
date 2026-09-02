import { readObjects, writeObjects, named, commitStatus, type AnnObj } from "./doc";

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

const empty = commitStatus([]);
assert(!empty.can_commit && empty.reasons[0] === "no objects", "empty");
const unlabeled = commitStatus([{ label: null }, { label: "untitled" }]);
assert(!unlabeled.can_commit && unlabeled.reasons[0] === "unnamed labels", "unlabeled");
const ok = commitStatus([{ label: null }, { label: "hand" }]);
assert(ok.can_commit && ok.reasons.length === 0, "named ok");

console.log("doc.test.ts ok");
