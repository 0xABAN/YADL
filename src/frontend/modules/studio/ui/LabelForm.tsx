"use client";

import type { CSSProperties } from "react";
import { classColor, named, type AnnObj } from "../geometry/doc";

export default function LabelForm({
  edit,
  draft,
  classes,
  objects,
  onDraft,
  onClose,
  onStamp,
  onDelete,
}: {
  edit: string;
  draft: string;
  classes: string[];
  objects: AnnObj[];
  onDraft: (v: string) => void;
  onClose: () => void;
  onStamp: (name: string) => void;
  onDelete: () => void;
}) {
  const editing = edit !== "new" ? objects.find((o) => o.id === edit) : undefined;
  const q = draft.trim();
  const shown = q ? classes.filter((c) => c.toLowerCase().includes(q.toLowerCase())) : classes;
  const fresh = q.length > 0 && !classes.some((c) => c.toLowerCase() === q.toLowerCase());

  return (
    <form
      className="ann"
      onSubmit={(e) => {
        e.preventDefault();
        onStamp(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <header>
        <label className="sr-only" htmlFor="ann-label">
          Label
        </label>
        <input
          id="ann-label"
          name="label"
          autoComplete="off"
          spellCheck={false}
          autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer:fine)").matches}
          value={draft}
          placeholder="Label…"
          onChange={(e) => onDraft(e.target.value)}
        />
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="ann-btns">
        <button type="submit" className="save">
          {edit === "new" ? "Create" : "Save"}
        </button>
        {edit !== "new" && (
          <button type="button" className="del" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
      {shown.length === 0 && !fresh ? (
        <p className="empty">No existing labels</p>
      ) : (
        <ul>
          {shown.map((name) => (
            <li key={name}>
              <button
                type="button"
                aria-current={
                  (editing && named(editing.label)?.toLowerCase() === name.toLowerCase()) ||
                  q.toLowerCase() === name.toLowerCase()
                    ? true
                    : undefined
                }
                style={{ "--cc": classColor(name, classes) } as CSSProperties}
                onClick={() => onStamp(name)}
              >
                <span className="swatch" aria-hidden="true" />
                {name}
              </button>
            </li>
          ))}
          {fresh && (
            <li>
              <button type="button" aria-current onClick={() => onStamp(q)}>
                Create “{q}”
              </button>
            </li>
          )}
        </ul>
      )}
    </form>
  );
}
