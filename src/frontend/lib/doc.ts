import type { Landmark } from "./hand";

export type HandObj = {
  id: string;
  kind: "hand";
  label: string | null;
  edited: boolean;
  geom: { t: "hand"; landmarks: Landmark[]; handedness: "Left" | "Right" | null };
};

export type Doc = {
  id: string;
  image: string;
  objects: HandObj[];
  url?: string | null;
  committed?: boolean;
  history?: { id: string; objects: HandObj[]; at?: string | null }[];
};

export type Project = {
  id: string;
  name: string;
  type: "boxes" | "polygons" | "hands";
  classes: string[];
};

export type ToolId = "move" | "box" | "polygon" | "landmarks" | "assist";

export const SHOWN: Record<Project["type"], ToolId[]> = {
  hands: ["move", "landmarks", "assist"],
  boxes: ["move", "box"],
  polygons: ["move", "polygon"],
};

export const CLASS_COLOR = ["#99edff", "#bfff00", "#ff9ffc", "#ffd43b", "#ffa8a8", "#c5f6fa"];

export function named(label: string | null) {
  return label && label !== "untitled" ? label : null;
}

export function classColor(label: string | null, classes: string[]) {
  const name = named(label);
  if (!name) return "#737373";
  const i = classes.indexOf(name);
  return CLASS_COLOR[(i < 0 ? 0 : i) % CLASS_COLOR.length];
}
