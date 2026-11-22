import { Button, Input } from "@fluentui/react-components";
import { Add16Regular, Subtract16Regular } from "@fluentui/react-icons";
import { normalizeDigits } from "../model";

export type NumericInputProps = {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  decimal?: boolean;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  disabled?: boolean;
  decreaseLabel?: string;
  increaseLabel?: string;
  "aria-label"?: string;
};

function sanitizeNumeric(raw: string, decimal: boolean): string {
  const ascii = normalizeDigits(raw).trim();
  if (!ascii) return "";
  if (!decimal) return ascii.replace(/[^\d]/g, "");
  let seenDot = false;
  let result = "";
  let decimals = 0;
  for (const ch of ascii) {
    if (ch >= "0" && ch <= "9") {
      if (seenDot) {
        if (decimals >= 2) continue;
        decimals++;
      }
      result += ch;
    } else if (ch === "." && !seenDot) {
      seenDot = true;
      result += result === "" ? "0." : ".";
    }
  }
  return result;
}

function toUnits(value: string, decimal: boolean): number | null {
  if (!value.trim()) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return decimal ? Math.round(num * 100) : Math.round(num);
}

function fromUnits(units: number, decimal: boolean): string {
  if (!decimal) return String(units);
  const whole = Math.floor(units / 100);
  const frac = units % 100;
  if (frac === 0) return String(whole);
  if (frac % 10 === 0) return `${whole}.${frac / 10}`;
  return `${whole}.${String(frac).padStart(2, "0")}`;
}

export function NumericInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  decimal = false,
  prefix,
  suffix,
  placeholder,
  disabled = false,
  decreaseLabel = "下调数值",
  increaseLabel = "上调数值",
  "aria-label": ariaLabel,
}: NumericInputProps) {
  const scale = decimal ? 100 : 1;
  const minUnits = min !== undefined ? Math.round(min * scale) : undefined;
  const maxUnits = max !== undefined ? Math.round(max * scale) : undefined;
  const currentUnits = toUnits(value, decimal);

  const stepBy = (direction: 1 | -1, large = false) => {
    if (disabled) return;
    const effectiveStep = step * (large ? 10 : 1);
    const stepUnits = Math.max(1, Math.round(effectiveStep * scale));
    let nextUnits: number;
    if (currentUnits === null) {
      if (direction < 0) return;
      nextUnits =
        minUnits !== undefined ? Math.max(minUnits, stepUnits) : stepUnits;
    } else {
      nextUnits = currentUnits + direction * stepUnits;
    }
    if (minUnits !== undefined) nextUnits = Math.max(minUnits, nextUnits);
    if (maxUnits !== undefined) nextUnits = Math.min(maxUnits, nextUnits);
    onChange(fromUnits(nextUnits, decimal));
  };

  const minusDisabled =
    disabled ||
    currentUnits === null ||
    (minUnits !== undefined && currentUnits <= minUnits);
  const plusDisabled =
    disabled ||
    (currentUnits !== null &&
      maxUnits !== undefined &&
      currentUnits >= maxUnits);

  return (
    <div className="numeric-field">
      <Input
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(_, d) => onChange(sanitizeNumeric(d.value, decimal))}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            stepBy(1, e.shiftKey);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            stepBy(-1, e.shiftKey);
          }
        }}
        contentBefore={
          prefix ? <span className="numeric-affix">{prefix}</span> : undefined
        }
        contentAfter={
          <span className="numeric-after">
            {suffix && <span className="numeric-affix">{suffix}</span>}
            <span className="numeric-steppers">
              <Button
                type="button"
                size="small"
                appearance="subtle"
                className="numeric-step-btn"
                icon={<Subtract16Regular />}
                aria-label={decreaseLabel}
                disabled={minusDisabled}
                onClick={(e) => stepBy(-1, e.shiftKey)}
              />
              <Button
                type="button"
                size="small"
                appearance="subtle"
                className="numeric-step-btn"
                icon={<Add16Regular />}
                aria-label={increaseLabel}
                disabled={plusDisabled}
                onClick={(e) => stepBy(1, e.shiftKey)}
              />
            </span>
          </span>
        }
      />
    </div>
  );
}
