import { expect, type Page } from "@playwright/test";

type RegisteredTool = {
  name: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => unknown;
};

type WebMcpWindow = typeof window & {
  __rejectWebMcpName?: string;
  __webMcpCall?: (name: string, args: Record<string, unknown>) => unknown;
  __webMcpSchema?: (name: string) => Record<string, unknown> | undefined;
  __webMcpNames?: () => string[];
};

export async function installWebMcpHost(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map<string, RegisteredTool>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: RegisteredTool, opts?: { signal?: AbortSignal }) {
          if ((window as WebMcpWindow).__rejectWebMcpName === tool.name) {
            throw new Error("forced registration failure");
          }
          tools.set(tool.name, tool);
          opts?.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
        },
      },
    });
    Object.assign(window, {
      __webMcpCall: (name: string, args: Record<string, unknown> = {}) => tools.get(name)?.execute(args),
      __webMcpSchema: (name: string) => tools.get(name)?.inputSchema,
      __webMcpNames: () => [...tools.keys()],
    });
  });
}

export function callTool(page: Page, name: string, args: Record<string, unknown> = {}) {
  return page.evaluate(
    ({ toolName, input }) => (window as WebMcpWindow).__webMcpCall?.(toolName, input),
    { toolName: name, input: args },
  );
}

export function getToolSchema(page: Page, name: string) {
  return page.evaluate((toolName) => (window as WebMcpWindow).__webMcpSchema?.(toolName), name);
}

export function toolNames(page: Page) {
  return page.evaluate(() => (window as WebMcpWindow).__webMcpNames?.() ?? []);
}

export async function waitForTool(page: Page, name: string) {
  await expect.poll(async () => (await toolNames(page)).includes(name)).toBe(true);
}
