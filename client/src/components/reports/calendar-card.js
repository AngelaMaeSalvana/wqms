import React from "react";

export default function CalendarCard({
  monthName,
  year,
  onPrevMonth,
  onNextMonth,
  calendarDays = [],
  isSameDate,
  selectedDate,
  onSelectDate,
}) {
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
          const hasData = day.wqi !== null && day.wqi !== undefined && !day.isFuture;

          if (!day.isCurrentMonth) className += " muted";
          else if (day.isFuture || !hasData) className += " muted";
          else if (day.isToday) className += ` highlight ${day.quality || ""}`;
          else if (day.quality) className += ` ${day.quality}`;
          else className += " muted";

          const isSelected = selectedDate && isSameDate?.(day.date, selectedDate);
          if (isSelected) className += " selected";

          return (
            <span
              key={`${day.date.getTime()}-${index}`}
              className={className}
              onClick={() => {
                if (day.isCurrentMonth && hasData) onSelectDate?.(day);
              }}
              style={{ cursor: day.isCurrentMonth && hasData ? "pointer" : "default" }}
              title={
                day.qualityData && hasData
                  ? `WQI: ${Math.round(day.wqi)} (Class ${day.qualityData.class} - ${day.qualityData.label})`
                  : day.isCurrentMonth
                  ? "No data available"
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
