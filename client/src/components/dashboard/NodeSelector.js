import React, { useState, useRef, useEffect } from "react";
import "./dashboard.css";

export function NodeSelector({ nodes = [], value, onChange, variant = "pill" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const selected = nodes.find((n) => n.id === value);
  const displayText = selected
    ? selected.name + (selected.location ? ` — ${selected.location}` : "")
    : "Select node…";

  useEffect(() => {
    if (variant !== "floating") return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [variant]);

  if (variant === "floating") {
    return (
      <div className="node-selector-floating" ref={containerRef}>
        <button
          type="button"
          className="node-selector-floating__trigger"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Select sensor node"
        >
          <span className="node-selector-floating__text">{displayText}</span>
          <span className="node-selector-floating__chevron" aria-hidden="true">▴</span>
        </button>
        {open && (
          <div
            className="node-selector-floating__menu"
            role="listbox"
            aria-label="Sensor nodes"
          >
            {nodes.map((n) => {
              const label = n.name + (n.location ? ` — ${n.location}` : "");
              return (
                <button
                  key={n.id}
                  type="button"
                  role="option"
                  aria-selected={n.id === value}
                  className={`node-selector-floating__item ${n.id === value ? "active" : ""}`}
                  onClick={() => {
                    onChange?.(n.id);
                    setOpen(false);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="node-selector-pill">
      <select
        className="node-selector-pill__select"
        value={value || ""}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label="Select sensor node"
        title={displayText}
      >
        <option value="">Select node…</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
            {n.location ? ` — ${n.location}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export default NodeSelector;
