"use client";

import { useRef, useState } from "react";
import { classColor, named, objTitle, type AnnObj } from "@/lib/doc";

export default function Classes({
  classes,
  objects,
  selected,
  tab,
  onTab,
  onSelect,
  onLabel,
  onRename,
  onDrop,
  onAdd,
  status,
}: {
  classes: string[];
  objects: AnnObj[];
  selected: string | null;
  tab: "labels" | "objects";
  onTab: (t: "labels" | "objects") => void;
  onSelect: (id: string) => void;
  onLabel: (label: string) => void;
  onRename: (old: string, name: string) => void;
  onDrop: (name: string) => void;
  onAdd: () => void;
  status?: string;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState("");
  const keep = useRef(true);
  const counts = Object.fromEntries(classes.map((c) => [c, objects.filter((o) => o.label === c).length]));
  const used = classes.filter((c) => counts[c]);
  const unused = classes.filter((c) => !counts[c]);

  const row = (name: string) => (
    <li key={name}>
      <button type="button" className="row-main" onClick={() => onLabel(name)}>
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
            onClick={(e) => e.stopPropagation()}
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
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(name);
              setText(name);
            }}
          >
            {name}
          </span>
        )}
      </button>
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
    <aside>
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
                <p className="empty-pane">No labels yet. Create one, then stamp a selection.</p>
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
                  No objects. Draw one or run Assist.
                </li>
              ) : (
                objects.map((o, i) => (
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
