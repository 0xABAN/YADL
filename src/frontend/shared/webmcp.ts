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
type ActivityFn = (name: string, active: boolean) => void;
const invokeListeners = new Set<InvokeFn>();
const activityListeners = new Set<ActivityFn>();

/** Subscribe to any registered tool execute (Studio toast, logging, …). */
export function onWebMcpInvoke(fn: InvokeFn): () => void {
  invokeListeners.add(fn);
  return () => {
    invokeListeners.delete(fn);
  };
}

/** Subscribe to WebMCP tool lifetime so UI side effects can stay call-scoped. */
export function onWebMcpActivity(fn: ActivityFn): () => void {
  activityListeners.add(fn);
  return () => {
    activityListeners.delete(fn);
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

function emitActivity(name: string, active: boolean) {
  for (const fn of activityListeners) {
    try {
      fn(name, active);
    } catch {
      /* listener errors must not break tools */
    }
  }
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

/** Enforce supplied JSON types because some WebMCP hosts currently expose schemas without validating calls. */
function typeErrors(value: unknown, schema: Record<string, unknown>, path = "$"): string[] {
  const declared = Array.isArray(schema.type)
    ? schema.type.filter((type): type is string => typeof type === "string")
    : typeof schema.type === "string"
      ? [schema.type]
      : [];
  if (declared.length && !declared.some((type) => matchesType(value, type))) {
    return [`${path}: expected ${declared.join(" or ")}`];
  }

  if (!declared.length && Array.isArray(schema.oneOf)) {
    const typedBranches = schema.oneOf.filter(
      (branch): branch is Record<string, unknown> =>
        Boolean(branch) && typeof branch === "object" && "type" in branch,
    );
    if (typedBranches.length) {
      let shortest: string[] | null = null;
      for (const branch of typedBranches) {
        const errors = typeErrors(value, branch, path);
        if (!errors.length) return [];
        if (!shortest || errors.length < shortest.length) shortest = errors;
      }
      return shortest ?? [];
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, unknown>)
        : {};
    const errors: string[] = [];
    for (const [key, child] of Object.entries(object)) {
      const childSchema = properties[key];
      if (childSchema && typeof childSchema === "object") {
        errors.push(...typeErrors(child, childSchema as Record<string, unknown>, `${path}.${key}`));
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(
          ...typeErrors(
            child,
            schema.additionalProperties as Record<string, unknown>,
            `${path}.${key}`,
          ),
        );
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: unexpected property`);
      }
    }
    return errors;
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    return value.flatMap((item, index) =>
      typeErrors(item, schema.items as Record<string, unknown>, `${path}[${index}]`),
    );
  }
  return [];
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
    execute: async (args, extra) => {
      emitInvoke(tool.name);
      onInvoke?.(tool.name);
      emitActivity(tool.name, true);
      try {
        const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
        const schema = tool.inputSchema;
        const properties =
          schema.properties && typeof schema.properties === "object"
            ? (schema.properties as Record<string, unknown>)
            : {};
        if (schema.additionalProperties === false) {
          const unexpected = Object.keys(input).filter((key) => !(key in properties)).sort();
          if (unexpected.length) return { error: "unexpected_arguments", keys: unexpected };
        }
        const details = typeErrors(input, schema);
        if (details.length) return { error: "invalid_arguments", details };
        return await tool.execute(input, extra);
      } finally {
        emitActivity(tool.name, false);
      }
    },
  };
}

/** Register tools in parallel; no-op when WebMCP is unavailable. */
export async function registerWebMcpTools(
  tools: WebMcpTool[],
  signal: AbortSignal,
  opts?: { onInvoke?: InvokeFn; onRegistrationError?: (name: string) => void },
): Promise<void> {
  const mc = (await waitCtx(signal)) ?? ctx();
  if (!mc || signal.aborted) return;
  await Promise.all(
    tools.map(async (tool) => {
      if (signal.aborted) return;
      try {
        await mc.registerTool(wrapTool(tool, opts?.onInvoke), { signal });
      } catch {
        opts?.onRegistrationError?.(tool.name);
      }
    }),
  );
}
