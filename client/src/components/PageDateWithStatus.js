import React, { useState, useEffect } from "react";
import LastUpdated from "./LastUpdated";
import "./PageDateWithStatus.css";

const DATE_TIME_OPTIONS = {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
};

/**
 * Live-updating date/time (every second) with optional "Last updated" status below.
 * Use on all pages for consistent header date and status.
 * @param {{ lastUpdated?: Date | null, className?: string }} props
 */
export default function PageDateWithStatus({ lastUpdated = null, className = "" }) {
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setCurrentTime(new Date());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={`page-date-with-status ${className}`.trim()} aria-live="polite">
      <span className="page-date">
        {currentTime.toLocaleString(undefined, DATE_TIME_OPTIONS)}
      </span>
      {lastUpdated != null && <LastUpdated timestamp={lastUpdated} />}
    </div>
  );
}
