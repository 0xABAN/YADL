import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CREATE_TOOL_SCHEMAS } from "../modules/create/createTools";
import { RIG_TOOL_SCHEMAS } from "../modules/studio/tools/rigTools";
import { BOX_TOOL_SCHEMAS, POLY_TOOL_SCHEMAS } from "../modules/studio/tools/shapeTools";
import { STUDIO_TOOL_SCHEMAS } from "../modules/studio/tools/studioTools";

const schemas = {
  "schema.json": CREATE_TOOL_SCHEMAS,
  "studio-schema.json": STUDIO_TOOL_SCHEMAS,
  "rig-schema.json": RIG_TOOL_SCHEMAS,
  "box-schema.json": BOX_TOOL_SCHEMAS,
  "poly-schema.json": POLY_TOOL_SCHEMAS,
};

test("checked-in WebMCP schemas match their runtime sources of truth", async () => {
  for (const [file, runtime] of Object.entries(schemas)) {
    const checkedIn = JSON.parse(
      readFileSync(join(process.cwd(), "webmcp-evals", file), "utf8"),
    );
    expect(checkedIn, file).toEqual(runtime);
  }
});
