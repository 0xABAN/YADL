"use client";

import { useRef, useState } from "react";
import { classColor, named, objTitle, type AnnObj } from "../geometry/doc";

export default function Classes({
  classes,
  objects,
  selected,
  tab,
  onTab,
  onSelect,
  onRename,
  onDrop,
  onAdd,
  status,
  onCollapse,
}: {
  classes: string[];
  objects: AnnObj[];
  selected: string | null;
  tab: "labels" | "objects";
  onTab: (t: "labels" | "objects") => void;
  onSelect: (id: string) => void;
  onRename: (old: string, name: string) => void;
  onDrop: (name: string) => void;
  onAdd: () => void;
  status?: string;
  onCollapse?: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState("");
  const keep = useRef(true);
  const counts: Record<string, number> = Object.fromEntries(classes.map((c) => [c, 0]));
  for (const o of objects) {
    if (o.label && o.label in counts) counts[o.label]++;
  }
  const used = classes.filter((c) => counts[c]);
  const unused = classes.filter((c) => !counts[c]);

  const row = (name: string) => (
    <li key={name}>
      <div className="row-main">
        <span className="swatch" style={{ background: classColor(name, classes) }} aria-hidden="true" />
        {renaming === name ? (
          <input
            id={`rename-${name}`}
            aria-label={`Rename ${name}`}
            autoFocus
            value={text}
            spellCheck={false}
            autoComplete="off"
            name="class-rename"
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (keep.current) onRename(name, text);
              keep.current = true;
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                keep.current = false;
                setRenaming(null);
              }
            }}
          />
        ) : (
          <span
            className="name"
            title="Double-click to rename"
            onDoubleClick={() => {
              setRenaming(name);
              setText(name);
            }}
          >
            {name}
          </span>
        )}
      </div>
      <span className="meta">
        <b className="nums">{counts[name] || 0}</b>
        <button
          type="button"
          className="kill"
          aria-label={`Delete ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDrop(name);
          }}
        >
          ×
        </button>
      </span>
    </li>
  );

  return (
    <aside
      onDoubleClick={(e) => {
        if (!onCollapse) return;
        const t = e.target;
        if (!(t instanceof Element)) return;
        // only empty chrome — not buttons, inputs, rows, tabs
        if (t.closest("button, a, input, label, .row-main, .labels li, .tabs")) return;
        onCollapse();
      }}
    >
      <div className="rail-ui">
        <div className="rail-head">
          <span className="brand" translate="no">
            yadl.
          </span>
        </div>
        <p className="lede">{"yet another data labeler, but in this one, you don't have to click."}</p>
        {status && (
          <p className="rail-status" aria-live="polite">
            {status}
          </p>
        )}
        <nav className="tabs" aria-label="Sidebar">
          <button type="button" aria-pressed={tab === "labels"} onClick={() => onTab("labels")}>
            Labels
          </button>
          <button type="button" aria-pressed={tab === "objects"} onClick={() => onTab("objects")}>
            Objects
          </button>
        </nav>
        <div className="pane">
          {tab === "labels" && (
            <>
              {classes.length === 0 ? (
                <p className="empty-pane">No labels yet. Create one, then assign it from an object.</p>
              ) : (
                <ul className="labels poses">{used.map((n) => row(n))}</ul>
              )}
              {unused.length > 0 && (
                <div className="unused">
                  <h2>Unused labels</h2>
                  <ul className="labels poses">{unused.map((n) => row(n))}</ul>
                </div>
              )}
              <button type="button" className="add-label" onClick={onAdd}>
                Create label (L)
              </button>
            </>
          )}
          {tab === "objects" && (
            <ul className="labels">
              {objects.length === 0 ? (
                <li className="empty-pane" style={{ display: "block" }}>
                  No objects. Draw one or run Auto Label.
                </li>
              ) : (
                objects.map((o) => (
                  <li key={o.id} aria-current={selected === o.id || undefined}>
                    <button type="button" className="row-main" onClick={() => onSelect(o.id)}>
                      <span className="swatch" style={{ background: classColor(o.label, classes) }} aria-hidden="true" />
                      <span className="name">
                        {objTitle(o, objects)}
                        {!named(o.label) ? " · unlabeled" : ""}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
