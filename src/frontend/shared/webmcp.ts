export type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => unknown | Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: WebMcpTool, opts?: { signal?: AbortSignal }) => Promise<void> | void;
};

function ctx(): ModelContext | null {
  if (typeof document === "undefined") return null;
  const mc = (document as Document & { modelContext?: ModelContext }).modelContext;
  return mc && typeof mc.registerTool === "function" ? mc : null;
}

/** Wait until document.modelContext exists or signal aborts. */
function waitCtx(signal: AbortSignal): Promise<ModelContext | null> {
  const hit = ctx();
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const tick = () => {
      if (signal.aborted) {
        cleanup();
        resolve(null);
        return;
      }
      const mc = ctx();
      if (mc) {
        cleanup();
        resolve(mc);
      }
    };
    const cleanup = () => {
      clearInterval(id);
      signal.removeEventListener("abort", tick);
    };
    const id = setInterval(tick, 200);
    signal.addEventListener("abort", tick);
  });
}

/** Register tools in parallel; no-op when WebMCP is unavailable. */
export async function registerWebMcpTools(
  tools: WebMcpTool[],
  signal: AbortSignal,
  opts?: { onInvoke?: (name: string) => void },
): Promise<void> {
  const mc = (await waitCtx(signal)) ?? ctx();
  if (!mc || signal.aborted) return;
  await Promise.all(
    tools.map(async (tool) => {
      if (signal.aborted) return;
      const wrapped: WebMcpTool = {
        ...tool,
        execute: (args, extra) => {
          opts?.onInvoke?.(tool.name);
          return tool.execute(args, extra);
        },
      };
      try {
        await mc.registerTool(wrapped, { signal });
      } catch {
        /* host may reject */
      }
    }),
  );
}
