import { parsePts } from "./shapeTools";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// object pts
{
  const r = parsePts([
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 },
    { x: 0.5, y: 0.6 },
  ]);
  assert(r.ok && r.pts.length === 3, "object pts");
}

// flat pts
{
  const r = parsePts([0.1, 0.1, 0.9, 0.1, 0.5, 0.9]);
  assert(r.ok && r.pts.length === 3 && r.pts[1].x === 0.9, "flat pts");
}

// too few
{
  const r = parsePts([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]);
  assert(!r.ok && r.error === "need_min_3_pts", "min 3");
}

// odd flat
{
  const r = parsePts([0, 0, 1, 1, 0.5]);
  assert(!r.ok && r.error === "bad_geom", "odd flat");
}

console.log("shapeTools.test.ts ok");
