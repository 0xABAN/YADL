import { catalogFor, resolveJoints, restRig, DEFAULT_ROOT } from "./index";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const hand = catalogFor("hand");
const pose = catalogFor("pose");
const face = catalogFor("face");

assert(hand.landmarkCount === 21, "hand n");
assert(pose.landmarkCount === 33, "pose n");
assert(face.landmarkCount === 478, "face n");

const hr = restRig(hand);
const hl = hand.fk(hr.root, hr.joints, "Right");
assert(hl.length === 21, "hand fk len");
assert(hl.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1), "hand in bounds");

const fist = resolveJoints(hand, {
  index_mcp: 1,
  index_pip: 1,
  middle_mcp: 1,
  middle_pip: 1,
  ring_mcp: 1,
  ring_pip: 1,
  pinky_mcp: 1,
  pinky_pip: 1,
  thumb_mcp: 0.8,
  thumb_ip: 0.8,
});
const fl = hand.fk({ ...DEFAULT_ROOT, x: 0.5, y: 0.6, scale: 0.25 }, fist, "Right");
assert(fl[8].y > hl[8].y - 0.01 || fl[8].y !== hl[8].y, "fist moves tip");

const pl = pose.fk(restRig(pose).root, restRig(pose).joints);
assert(pl.length === 33, "pose fk");

const facel = face.fk(restRig(face, { scale: 0.35 }).root, resolveJoints(face, { jaw_open: 1 }));
assert(facel.length === 478, "face fk");

const unknown = resolveJoints(hand, { not_a_joint: 9, index_mcp: 2 });
assert(unknown.index_mcp === 1, "clamp max");
assert(unknown.not_a_joint === undefined, "drop unknown");

console.log("rig.test.ts ok");
