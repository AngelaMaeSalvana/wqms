import React, { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import "./InfoTooltip.css";

/**
 * A small question mark icon in a circle. Click to show the tooltip text.
 * Renders tooltip in a portal so it isn't clipped by parent overflow.
 */
export default function InfoTooltip({ text, label = "More info" }) {
  const id = useId();
  const tooltipId = `info-tooltip-${id.replace(/:/g, "")}`;
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);

  const [place, setPlace] = useState("right"); // "left" | "right"

  useEffect(() => {
    if (!visible || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 10;
    const spaceRight = window.innerWidth - rect.right - gap;
    const spaceLeft = rect.left - gap;
    const showOnLeft = spaceLeft > spaceRight;
    setPlace(showOnLeft ? "left" : "right");
    setPosition({
      top: rect.top + rect.height / 2,
      left: showOnLeft ? rect.left - gap : rect.right + gap,
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handleClickOutside = (e) => {
      const clickedTrigger = triggerRef.current?.contains(e.target);
      const clickedTooltip = document.getElementById(tooltipId)?.contains(e.target);
      if (!clickedTrigger && !clickedTooltip) {
        setVisible(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [visible, tooltipId]);

  return (
    <span className="info-tooltip">
      <button
        ref={triggerRef}
        type="button"
        className="info-tooltip__trigger"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-expanded={visible}
        aria-haspopup="dialog"
        aria-describedby={visible ? tooltipId : undefined}
      >
        ?
      </button>
      {visible &&
        createPortal(
          <span
            id={tooltipId}
            className={`info-tooltip__content info-tooltip__content--portal info-tooltip__content--${place}`}
            role="tooltip"
            style={{
              top: position.top,
              left: position.left,
              transform: place === "left" ? "translate(-100%, -50%)" : "translateY(-50%)",
            }}
          >
            {text}
          </span>,
          document.body
        )}
    </span>
  );
}
