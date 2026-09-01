import type { KeypointTemplate } from "../doc";
import { faceCatalog } from "./face";
import { handCatalog } from "./hand";
import { poseCatalog } from "./pose";
import type { TemplateCatalog } from "./types";

export * from "./types";
export { handCatalog, poseCatalog, faceCatalog };

export function catalogFor(template: KeypointTemplate | null | undefined): TemplateCatalog {
  if (template === "pose") return poseCatalog;
  if (template === "face") return faceCatalog;
  return handCatalog;
}
