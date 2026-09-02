export type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => unknown | Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: WebMcpTool, opts?: { signal?: AbortSignal }) => Promise<void> | void;
};

type InvokeFn = (name: string) => void;
const invokeListeners = new Set<InvokeFn>();

/** Subscribe to any registered tool execute (Studio toast, logging, …). */
export function onWebMcpInvoke(fn: InvokeFn): () => void {
  invokeListeners.add(fn);
  return () => {
    invokeListeners.delete(fn);
  };
}

function emitInvoke(name: string) {
  for (const fn of invokeListeners) {
    try {
      fn(name);
    } catch {
      /* listener errors must not break tools */
    }
  }
}

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

function wrapTool(tool: WebMcpTool, onInvoke?: InvokeFn): WebMcpTool {
  return {
    ...tool,
    execute: (args, extra) => {
      emitInvoke(tool.name);
      onInvoke?.(tool.name);
      return tool.execute(args, extra);
    },
  };
}

/** Register tools in parallel; no-op when WebMCP is unavailable. */
export async function registerWebMcpTools(
  tools: WebMcpTool[],
  signal: AbortSignal,
  opts?: { onInvoke?: InvokeFn },
): Promise<void> {
  const mc = (await waitCtx(signal)) ?? ctx();
  if (!mc || signal.aborted) return;
  await Promise.all(
    tools.map(async (tool) => {
      if (signal.aborted) return;
      try {
        await mc.registerTool(wrapTool(tool, opts?.onInvoke), { signal });
      } catch {
        /* host may reject */
      }
    }),
  );
}
