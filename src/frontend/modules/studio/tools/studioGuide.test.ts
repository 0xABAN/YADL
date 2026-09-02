import { geometryToolNames, studioGuidePayload, STUDIO_GUIDE, type StudioSnapshot } from "./studioTools";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(STUDIO_GUIDE.length >= 5, "guide non-empty");
assert(geometryToolNames("boxes").includes("add_box"), "boxes");
assert(geometryToolNames("polygons").includes("add_polygon"), "polys");
assert(geometryToolNames("keypoints").includes("set_rig"), "rig");
assert(geometryToolNames("nope").length === 0, "unknown");

const snap: StudioSnapshot = {
  projectId: "p",
  project: { id: "p", name: "n", type: "keypoints", template: "face", classes: [] },
  list: [],
  index: 0,
  doc: null,
};
const out = studioGuidePayload(snap);
assert(out.guide.length === STUDIO_GUIDE.length, "guide copy");
assert(out.project?.type === "keypoints" && out.project.template === "face", "live pointer");
assert(out.geometry_tools.join(",") === "get_rig,set_rig,add_instance", "geom names");

console.log("studioGuide.test.ts ok");
