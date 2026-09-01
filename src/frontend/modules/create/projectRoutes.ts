/** Deep links for create → upload → studio. */

export function uploadPath(opts: {
  id?: string;
  name?: string;
  type?: string;
  template?: string;
}): string {
  const u = new URLSearchParams();
  if (opts.id) u.set("id", opts.id);
  if (opts.name) u.set("name", opts.name);
  if (opts.type) u.set("type", opts.type);
  if (opts.template) u.set("template", opts.template);
  const q = u.toString();
  return q ? `/upload?${q}` : "/upload";
}

export function studioPath(id: string): string {
  return `/studio/${id}`;
}
