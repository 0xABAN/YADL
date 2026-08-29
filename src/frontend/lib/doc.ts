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
