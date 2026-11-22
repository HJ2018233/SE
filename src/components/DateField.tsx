import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  Popover,
  PopoverSurface,
  Text,
} from "@fluentui/react-components";
import {
  CalendarLtr20Regular,
  ChevronLeft16Regular,
  ChevronRight16Regular,
  Dismiss16Regular,
} from "@fluentui/react-icons";
import {
  daysInMonth,
  formatIsoDate,
  isValidIsoDate,
  normalizeDigits,
  parseIsoDate,
  shortDate,
  TODAY,
} from "../model";

export type DateFieldProps = {
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  maxDate?: string;
  rangeStart?: string;
  rangeEnd?: string;
  rangeHint?: string;
  clearable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  onValidityChange?: (error: string) => void;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function normalizeDateDraft(raw: string): string {
  const ascii = normalizeDigits(raw).trim();
  if (!ascii) return "";
  const cleaned = ascii.replace(/[/／.－—\s]+/g, "-");
  const match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return ascii;
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function initialMonth(value: string, minDate?: string): { year: number; month: number } {
  const target =
    parseIsoDate(value) ||
    (minDate ? parseIsoDate(minDate) : null) ||
    parseIsoDate(TODAY) || { year: 2026, month: 1 };
  return { year: target.year, month: target.month };
}

export function FluentDatePicker({
  value,
  onChange,
  minDate,
  maxDate,
  rangeStart,
  rangeEnd,
  rangeHint,
  clearable = false,
  placeholder = "YYYY-MM-DD",
  disabled = false,
  "aria-label": ariaLabel,
  onValidityChange,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [localError, setLocalError] = useState("");
  const [view, setView] = useState(() => initialMonth(value, minDate));
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarId = useId();

  useEffect(() => {
    setText(value);
    if (!value || isValidIsoDate(value)) {
      setLocalError("");
      onValidityChange?.("");
    }
  }, [value]);

  const setValidationError = (message: string) => {
    setLocalError(message);
    onValidityChange?.(message);
  };

  const openCalendar = () => {
    if (disabled) return;
    setView(initialMonth(value, minDate));
    setOpen((prev) => !prev);
  };

  const handleInputChange = (nextRaw: string) => {
    setText(nextRaw);
    const trimmed = nextRaw.trim();
    if (!trimmed) {
      setValidationError("");
      onChange("");
      return;
    }
    const normalized = normalizeDateDraft(trimmed);
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      if (!isValidIsoDate(normalized)) {
        setValidationError("该公历日期不存在，请核对月份天数或平闰年。");
        return;
      }
      setValidationError("");
      onChange(normalized);
      const parsed = parseIsoDate(normalized);
      if (parsed) setView({ year: parsed.year, month: parsed.month });
    } else if (localError) {
      setValidationError("");
    }
  };

  const commitDraft = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setValidationError("");
      if (value !== "") onChange("");
      return;
    }
    const normalized = normalizeDateDraft(trimmed);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      setValidationError("请输入 YYYY-MM-DD 格式的有效公历日期。");
      return;
    }
    if (!isValidIsoDate(normalized)) {
      setValidationError("该公历日期不存在，请核对月份天数或平闰年。");
      return;
    }
    if (normalized !== text) setText(normalized);
    setValidationError("");
    if (normalized !== value) onChange(normalized);
  };

  const dialogSurface =
    (anchorEl?.closest(".fui-DialogSurface") as HTMLElement | null) ??
    undefined;

  const minParsed = minDate ? parseIsoDate(minDate) : null;
  const maxParsed = maxDate ? parseIsoDate(maxDate) : null;
  const canGoPrev =
    !minParsed ||
    view.year > minParsed.year ||
    (view.year === minParsed.year && view.month > minParsed.month);
  const canGoNext =
    !maxParsed ||
    view.year < maxParsed.year ||
    (view.year === maxParsed.year && view.month < maxParsed.month);

  const shiftMonth = (delta: number) => {
    setView((curr) => {
      const idx = curr.year * 12 + (curr.month - 1) + delta;
      return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
    });
  };

  const cells = useMemo(() => {
    const firstWeekday =
      (new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay() + 6) % 7;
    const totalDays = daysInMonth(view.year, view.month);
    const items: ({ day: number; iso: string } | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) items.push(null);
    for (let day = 1; day <= totalDays; day++) {
      items.push({ day, iso: formatIsoDate(view.year, view.month, day) });
    }
    return items;
  }, [view.year, view.month]);

  const selectDate = (iso: string) => {
    setText(iso);
    setValidationError("");
    onChange(iso);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const todayValid =
    (!minDate || TODAY >= minDate) && (!maxDate || TODAY <= maxDate);

  return (
    <div className="date-field-wrap">
      <div className="date-field-anchor" ref={setAnchorEl}>
        <Input
          type="text"
          inputMode="numeric"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={localError ? true : undefined}
          onChange={(_, d) => handleInputChange(d.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitDraft();
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === "ArrowDown" && e.altKey && !open) {
              e.preventDefault();
              openCalendar();
            }
          }}
          contentAfter={
            <span className="date-field-actions">
              {clearable && text && !disabled && (
                <Button
                  type="button"
                  size="small"
                  appearance="transparent"
                  className="date-clear-btn"
                  icon={<Dismiss16Regular />}
                  aria-label="清除日期"
                  onClick={() => {
                    setText("");
                    setValidationError("");
                    onChange("");
                  }}
                />
              )}
              <Button
                ref={triggerRef}
                type="button"
                size="small"
                appearance="transparent"
                className="date-trigger-btn"
                disabled={disabled}
                icon={<CalendarLtr20Regular />}
                aria-label="打开日历选择日期"
                aria-expanded={open}
                aria-controls={open ? calendarId : undefined}
                onClick={openCalendar}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && open) {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                  }
                }}
              />
            </span>
          }
        />
      </div>
      {localError && (
        <Text role="alert" size={200} className="field-inline-error">
          {localError}
        </Text>
      )}
      <Popover
        open={open}
        mountNode={dialogSurface}
        positioning={{
          target: anchorEl,
          position: "below",
          align: "start",
          fallbackPositions: ["above-start", "below-end", "above-end"],
          offset: { mainAxis: 6 },
          strategy: dialogSurface ? "fixed" : "absolute",
        }}
        onOpenChange={(e, data) => {
          if (
            !data.open &&
            e &&
            "target" in e &&
            e.target instanceof Node &&
            anchorEl?.contains(e.target)
          ) {
            return;
          }
          setOpen(data.open);
        }}
      >
        <PopoverSurface
          id={calendarId}
          className="date-popover-surface"
          aria-label="日历日期选择"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              requestAnimationFrame(() => triggerRef.current?.focus());
            }
          }}
        >
          <div className="date-cal-header">
            <Button
              type="button"
              size="small"
              appearance="subtle"
              icon={<ChevronLeft16Regular />}
              aria-label="上个月"
              disabled={!canGoPrev}
              onClick={() => shiftMonth(-1)}
            />
            <Text weight="semibold" size={300} className="date-cal-title">
              {view.year} 年 {view.month} 月
            </Text>
            <Button
              type="button"
              size="small"
              appearance="subtle"
              icon={<ChevronRight16Regular />}
              aria-label="下个月"
              disabled={!canGoNext}
              onClick={() => shiftMonth(1)}
            />
          </div>
          <div className="date-cal-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="date-cal-grid" role="group" aria-label={`${view.year}年${view.month}月`}>
            {cells.map((cell, index) => {
              if (!cell)
                return <span key={`pad-${index}`} className="date-cal-pad" />;
              const isDisabled =
                (Boolean(minDate) && cell.iso < minDate!) ||
                (Boolean(maxDate) && cell.iso > maxDate!);
              const isSelected = cell.iso === value;
              const isEndpoint =
                cell.iso === rangeStart || cell.iso === rangeEnd;
              const inRange =
                Boolean(rangeStart && rangeEnd && rangeEnd > rangeStart) &&
                cell.iso > rangeStart! &&
                cell.iso < rangeEnd!;
              const isToday = cell.iso === TODAY;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  disabled={isDisabled}
                  aria-label={`${view.year}年${view.month}月${cell.day}日`}
                  aria-pressed={isSelected || isEndpoint}
                  className={[
                    "date-cal-day",
                    isSelected || isEndpoint ? "selected" : "",
                    inRange ? "in-range" : "",
                    isToday ? "today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => selectDate(cell.iso)}
                >
                  <span>{cell.day}</span>
                </button>
              );
            })}
          </div>
          <div className="date-cal-footer">
            <Text size={200} className="muted">
              {rangeHint ||
                (value && isValidIsoDate(value)
                  ? `已选 ${shortDate(value)}`
                  : "按公历有效天数选择")}
            </Text>
            <div className="date-cal-footer-actions">
              {todayValid && (
                <Button
                  type="button"
                  size="small"
                  appearance="subtle"
                  onClick={() => selectDate(TODAY)}
                >
                  今天
                </Button>
              )}
              {clearable && value && (
                <Button
                  type="button"
                  size="small"
                  appearance="subtle"
                  onClick={() => {
                    setText("");
                    setValidationError("");
                    onChange("");
                    setOpen(false);
                  }}
                >
                  清除
                </Button>
              )}
            </div>
          </div>
        </PopoverSurface>
      </Popover>
    </div>
  );
}
