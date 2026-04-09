import React from "react";

function toMidnight(d) {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export default function CalendarCard({
  monthName,
  year,
  onPrevMonth,
  onNextMonth,
  calendarDays = [],
  isSameDate,
  selectedDate,
  onSelectDate,
  rangeStart,
  rangeEnd,
}) {
  const rsDate = toMidnight(rangeStart);
  const reDate = toMidnight(rangeEnd);

  return (
    <section className="card calendar-card">
      <header className="section-header">
        <h2>{monthName} {year}</h2>
        <div className="controls">
          <button onClick={onPrevMonth} aria-label="Previous month">◀</button>
          <button onClick={onNextMonth} aria-label="Next month">▶</button>
        </div>
      </header>

      <div className="calendar-weekdays">
        <span>SUN</span><span>MON</span><span>TUE</span><span>WED</span>
        <span>THU</span><span>FRI</span><span>SAT</span>
      </div>

      <div className="calendar-grid">
        {calendarDays.map((day, index) => {
          let className = "day";
          const hasWqi = day.wqi != null && !day.isFuture;

          if (!day.isCurrentMonth) className += " muted";
          else if (day.isFuture || !hasWqi) className += " muted";
          else if (day.isToday) className += ` highlight ${day.quality || ""}`;
          else if (day.quality) className += ` ${day.quality}`;
          else className += " muted";

          const isSelected = selectedDate && isSameDate?.(day.date, selectedDate);
          if (isSelected) className += " selected";

          // Highlight days in the shared filter range
          const dayMid = toMidnight(day.date);
          const inRange = rsDate && reDate && dayMid >= rsDate && dayMid <= reDate;
          if (inRange) className += " in-filter-range";
          // Distinguish days in range but without WQI (partial data only)
          if (inRange && day.isCurrentMonth && !hasWqi) className += " in-filter-range--no-wqi";

          return (
            <span
              key={`${day.date.getTime()}-${index}`}
              className={className}
              onClick={() => {
                if (day.isCurrentMonth && hasWqi) onSelectDate?.(day);
              }}
              style={{ cursor: day.isCurrentMonth && hasWqi ? "pointer" : "default" }}
              title={
                hasWqi
                  ? `WQI: ${Math.round(day.wqi)} (Class ${day.qualityData?.class ?? "?"} - ${day.qualityData?.label ?? "?"})`
                  : day.isCurrentMonth && !day.isFuture
                  ? "No WQI — need 3+ parameters (e.g. temp, turbidity, pH or DO). Sensors only provide temp & turbidity."
                  : ""
              }
            >
              {day.label}
            </span>
          );
        })}
      </div>
    </section>
  );
}
