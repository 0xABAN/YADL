import { classColor, objTitle, type AnnObj } from "./doc";

export type Comment = {
  id: string;
  body: string;
  mentions: string[];
  at?: string | null;
};

export type Part =
  | { type: "text"; value: string }
  | { type: "mention"; id: string; title: string; color: string; missing: boolean };

const TOKEN = /@\{\{([^}]+)\}\}/g;

export function mentionsOf(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(TOKEN)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

export function tokenFor(id: string) {
  return `@{{${id}}}`;
}

export function parseBody(body: string, objects: AnnObj[], classes: string[]): Part[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const parts: Part[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ type: "text", value: body.slice(last, start) });
    const id = m[1];
    const hit = byId.get(id);
    if (hit) {
      parts.push({
        type: "mention",
        id,
        title: objTitle(hit, objects),
        color: classColor(hit.label, classes),
        missing: false,
      });
    } else {
      parts.push({ type: "mention", id, title: "deleted", color: "#737373", missing: true });
    }
    last = start + m[0].length;
  }
  if (last < body.length) parts.push({ type: "text", value: body.slice(last) });
  return parts;
}

export function readComments(raw: unknown): Comment[] {
  if (!Array.isArray(raw)) return [];
  const out: Comment[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const row = c as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.body !== "string") continue;
    out.push({
      id: row.id,
      body: row.body,
      mentions: Array.isArray(row.mentions) ? row.mentions.map(String) : mentionsOf(row.body),
      at: typeof row.at === "string" ? row.at : null,
    });
  }
  return out;
}
