export type Landmark = { x: number; y: number; z: number };

export const NAMES = [
  "WRIST",
  "THUMB_CMC",
  "THUMB_MCP",
  "THUMB_IP",
  "THUMB_TIP",
  "INDEX_MCP",
  "INDEX_PIP",
  "INDEX_DIP",
  "INDEX_TIP",
  "MIDDLE_MCP",
  "MIDDLE_PIP",
  "MIDDLE_DIP",
  "MIDDLE_TIP",
  "RING_MCP",
  "RING_PIP",
  "RING_DIP",
  "RING_TIP",
  "PINKY_MCP",
  "PINKY_PIP",
  "PINKY_DIP",
  "PINKY_TIP",
] as const;

export const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

export type Region = "wrist" | "joint" | "tip";

export function region(i: number): Region {
  if (i === 0) return "wrist";
  if (i === 4 || i === 8 || i === 12 || i === 16 || i === 20) return "tip";
  return "joint";
}

export const HAND_COLOR = ["#99edff", "#bfff00"] as const;

export type FingerJ = { spread: number; mcp: number; pip: number };
export type Joints = {
  wrist: { pitch: number; yaw: number; roll: number };
  thumb: FingerJ & { opposition: number };
  index: FingerJ;
  middle: FingerJ;
  ring: FingerJ;
  pinky: FingerJ;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rad = (d: number) => (d * Math.PI) / 180;

const OPEN: Joints = {
  wrist: { pitch: 0, yaw: 0, roll: 0 },
  thumb: { opposition: 20, spread: -10, mcp: 15, pip: 10 },
  index: { spread: -12, mcp: 8, pip: 5 },
  middle: { spread: 0, mcp: 6, pip: 4 },
  ring: { spread: 12, mcp: 8, pip: 6 },
  pinky: { spread: 22, mcp: 10, pip: 8 },
};

const FINGERS: {
  key: "thumb" | "index" | "middle" | "ring" | "pinky";
  heading: number;
  palm: number;
  lens: [number, number, number];
}[] = [
  { key: "thumb", heading: -1.05, palm: 0.11, lens: [0.075, 0.055, 0.045] },
  { key: "index", heading: -0.3, palm: 0.2, lens: [0.09, 0.055, 0.042] },
  { key: "middle", heading: 0, palm: 0.215, lens: [0.1, 0.06, 0.045] },
  { key: "ring", heading: 0.28, palm: 0.2, lens: [0.09, 0.055, 0.04] },
  { key: "pinky", heading: 0.54, palm: 0.17, lens: [0.072, 0.045, 0.038] },
];

export function pose(j: Joints): Landmark[] {
  const roll = rad(clamp(j.wrist.roll, -60, 60));
  const pitch = rad(clamp(j.wrist.pitch, -45, 45));
  const yaw = rad(clamp(j.wrist.yaw, -45, 45));
  const wx = 0.52;
  const wy = 0.78;
  const out: Landmark[] = new Array(21);
  const put = (i: number, hx: number, hy: number, z: number) => {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    const x = hx * c - hy * s;
    const y = hx * s + hy * c;
    out[i] = {
      x: clamp(wx + x + Math.sin(yaw) * 0.04, 0, 1),
      y: clamp(wy - y, 0, 1),
      z: z + Math.sin(pitch) * y,
    };
  };
  put(0, 0, 0, 0);
  let i = 1;
  for (const f of FINGERS) {
    const fj = j[f.key];
    const opp = "opposition" in fj ? clamp(fj.opposition, 0, 90) : 0;
    const heading = f.heading + rad(clamp(fj.spread, -35, 35)) - rad(opp) * 0.5;
    const mcp = clamp(fj.mcp, 0, 90);
    const pip = clamp(fj.pip, 0, 110);
    const dip = pip * 0.66;
    let x = 0;
    let y = 0;
    let z = 0;
    const segs: [number, number][] = [
      [f.palm, f.key === "thumb" ? opp * 0.3 : 0],
      [f.lens[0], mcp],
      [f.lens[1], pip],
      [f.lens[2], dip],
    ];
    for (const [len, flex] of segs) {
      const reach = len * Math.cos(rad(flex));
      x += Math.sin(heading) * reach;
      y += Math.cos(heading) * reach;
      z += len * Math.sin(rad(flex));
      put(i++, x, y, z);
    }
  }
  return out;
}

export const PRESETS: Record<string, Joints> = {
  open: OPEN,
  fist: {
    wrist: { pitch: 10, yaw: 0, roll: 0 },
    thumb: { opposition: 55, spread: 5, mcp: 50, pip: 40 },
    index: { spread: -8, mcp: 78, pip: 95 },
    middle: { spread: 0, mcp: 80, pip: 95 },
    ring: { spread: 8, mcp: 80, pip: 95 },
    pinky: { spread: 16, mcp: 82, pip: 90 },
  },
  point: {
    wrist: { pitch: 0, yaw: 0, roll: 0 },
    thumb: { opposition: 45, spread: 0, mcp: 40, pip: 30 },
    index: { spread: -10, mcp: 8, pip: 4 },
    middle: { spread: 4, mcp: 78, pip: 95 },
    ring: { spread: 10, mcp: 80, pip: 95 },
    pinky: { spread: 18, mcp: 82, pip: 90 },
  },
  pinch: {
    wrist: { pitch: 0, yaw: 0, roll: 0 },
    thumb: { opposition: 40, spread: 5, mcp: 35, pip: 30 },
    index: { spread: -8, mcp: 40, pip: 35 },
    middle: { spread: 4, mcp: 20, pip: 15 },
    ring: { spread: 12, mcp: 25, pip: 20 },
    pinky: { spread: 20, mcp: 30, pip: 22 },
  },
  thumbs_up: {
    wrist: { pitch: 0, yaw: 0, roll: 55 },
    thumb: { opposition: 5, spread: -5, mcp: 5, pip: 5 },
    index: { spread: -8, mcp: 78, pip: 95 },
    middle: { spread: 0, mcp: 80, pip: 95 },
    ring: { spread: 8, mcp: 80, pip: 95 },
    pinky: { spread: 16, mcp: 82, pip: 90 },
  },
  ok: {
    wrist: { pitch: 0, yaw: 0, roll: 0 },
    thumb: { opposition: 35, spread: 8, mcp: 30, pip: 25 },
    index: { spread: -6, mcp: 45, pip: 50 },
    middle: { spread: 4, mcp: 10, pip: 8 },
    ring: { spread: 12, mcp: 12, pip: 10 },
    pinky: { spread: 20, mcp: 14, pip: 10 },
  },
};

// later: hand = result.landmarks[0]
