import React, { useEffect, useState } from "react";
import { loadFromStorage } from "../utils/settingsStorage";
import "./CurrentClassification.css";

const CLASSIFICATION_STORAGE_KEY = "wqms_threshold_classification";
const DEFAULT_CLASSIFICATION = "Custom";

const normalizeClassification = (value) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return DEFAULT_CLASSIFICATION;
};

const parseStorageValue = (raw) => {
  if (raw == null) return DEFAULT_CLASSIFICATION;
  if (typeof raw !== "string") return normalizeClassification(raw);
  try {
    return normalizeClassification(JSON.parse(raw));
  } catch {
    return normalizeClassification(raw);
  }
};

export default function CurrentClassification({ className = "", showLabel = true }) {
  const [classification, setClassification] = useState(() =>
    normalizeClassification(loadFromStorage(CLASSIFICATION_STORAGE_KEY, DEFAULT_CLASSIFICATION))
  );

  useEffect(() => {
    const handleStorageEvent = (event) => {
      if (!event || event.key !== CLASSIFICATION_STORAGE_KEY) return;
      setClassification(parseStorageValue(event.newValue));
    };

    const handleLocalEvent = (event) => {
      const detail = event?.detail;
      if (!detail || detail.key !== CLASSIFICATION_STORAGE_KEY) return;
      setClassification(normalizeClassification(detail.value));
    };

    window.addEventListener("storage", handleStorageEvent);
    window.addEventListener("wqms:storage", handleLocalEvent);
    return () => {
      window.removeEventListener("storage", handleStorageEvent);
      window.removeEventListener("wqms:storage", handleLocalEvent);
    };
  }, []);

  return (
    <span
      className={`page-classification ${className}`.trim()}
      aria-label={showLabel ? "Current classification" : `Current classification: ${classification}`}
    >
      {showLabel && <span className="page-classification__label">Classification</span>}
      <span className="page-classification__value">{classification}</span>
    </span>
  );
}
