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
};

export type Project = {
  type: "boxes" | "polygons" | "hands";
  classes: string[];
};
