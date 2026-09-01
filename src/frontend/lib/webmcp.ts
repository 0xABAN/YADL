/** Thin WebMCP helpers — feature-detect + register with AbortSignal cleanup. */

export type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => unknown | Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: WebMcpTool, opts?: { signal?: AbortSignal }) => Promise<void> | void;
};

function ctx(): ModelContext | null {
  if (typeof document === "undefined") return null;
  const mc = (document as Document & { modelContext?: ModelContext }).modelContext;
  return mc && typeof mc.registerTool === "function" ? mc : null;
}

export function webmcpAvailable(): boolean {
  return !!ctx();
}

/** Register tools; aborts previous registration when called again with a new signal. */
export async function registerWebMcpTools(tools: WebMcpTool[], signal: AbortSignal): Promise<boolean> {
  const mc = ctx();
  if (!mc || signal.aborted) return false;
  for (const tool of tools) {
    if (signal.aborted) return false;
    try {
      await mc.registerTool(tool, { signal });
    } catch {
      // Origin trial / host may reject; page still works without WebMCP.
    }
  }
  return true;
}
