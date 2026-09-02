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

/** Register tools in parallel; no-op when WebMCP is unavailable. */
export async function registerWebMcpTools(
  tools: WebMcpTool[],
  signal: AbortSignal,
  opts?: { onInvoke?: (name: string) => void },
): Promise<void> {
  const mc = ctx();
  if (!mc || signal.aborted) return;
  await Promise.all(
    tools.map(async (tool) => {
      if (signal.aborted) return;
      const wrapped: WebMcpTool = {
        ...tool,
        execute: (args) => {
          opts?.onInvoke?.(tool.name);
          return tool.execute(args);
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
