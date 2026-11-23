import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PropsWithChildren, ReactNode } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
} from "@fluentui/react-components";
import {
  ArrowLeft20Regular,
  CalendarLtr24Regular,
  Search24Regular,
} from "@fluentui/react-icons";
import {
  addDays,
  days,
  isValidIsoDate,
  money,
  shortDate,
  TODAY,
  total,
  weekday,
  validConditions,
} from "../model";
import type { Conditions, Night, OrderStatus } from "../model";
import { useApp } from "../context";
import { FluentDatePicker } from "./DateField";
import { NumericInput } from "./NumericInput";

function FocusReturnSurface({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  const target = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestAnimationFrame(() => {
        if (!mounted.current && target.current?.isConnected)
          target.current.focus();
      });
    };
  }, []);
  return <DialogSurface className={className}>{children}</DialogSurface>;
}

export function Heading({
  eyebrow,
  title,
  children,
  action,
}: PropsWithChildren<{ eyebrow?: string; title: string; action?: ReactNode }>) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && (
          <Text className="eyebrow" size={200}>
            {eyebrow}
          </Text>
        )}
        <Text as="h1" size={800} weight="semibold">
          {title}
        </Text>
        {children && <div className="heading-description">{children}</div>}
      </div>
      {action && <div className="heading-actions">{action}</div>}
    </header>
  );
}
export function Back({ to, label = "返回" }: { to: string; label?: string }) {
  const { go } = useApp();
  return (
    <Button
      appearance="subtle"
      icon={<ArrowLeft20Regular />}
      onClick={() => go(to)}
      className="back-button"
    >
      {label}
    </Button>
  );
}
export function Status({ status }: { status: OrderStatus }) {
  const color =
    status === "待确认"
      ? "warning"
      : status === "已确认"
        ? "brand"
        : status === "已入住"
          ? "success"
          : status === "已拒绝"
            ? "danger"
            : "subtle";
  return (
    <Badge appearance="tint" color={color}>
      {status}
    </Badge>
  );
}
export function NightStateBadge({ state }: { state: string }) {
  const color =
    state === "预占"
      ? "warning"
      : state === "承诺"
        ? "brand"
        : state === "在住占用"
          ? "success"
          : state === "已消费"
            ? "informative"
            : "subtle";
  return (
    <Badge appearance="tint" color={color}>
      {state}
    </Badge>
  );
}
export function Notice({
  children,
  intent = "info",
}: PropsWithChildren<{ intent?: "success" | "error" | "warning" | "info" }>) {
  return (
    <MessageBar intent={intent} layout="multiline">
      <MessageBarBody>{children}</MessageBarBody>
    </MessageBar>
  );
}
export function Empty({
  title,
  children,
  action,
}: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <section className="empty-state">
      <Search24Regular />
      <Text as="h2" size={600} weight="semibold">
        {title}
      </Text>
      <p className="muted">{children}</p>
      {action}
    </section>
  );
}
export function Price({
  value,
  size = "normal",
}: {
  value: number;
  size?: "normal" | "large";
}) {
  return (
    <Text
      weight="semibold"
      size={size === "large" ? 800 : 600}
      className="price"
    >
      {money(value)}
    </Text>
  );
}
export function NightQuote({
  nights,
  rooms = 1,
  compact = false,
  label = "逐晚报价",
  changedDates,
}: {
  nights: Night[];
  rooms?: number;
  compact?: boolean;
  label?: string;
  changedDates?: Set<string>;
}) {
  return (
    <section
      className={`quote ${compact ? "quote-compact" : ""}`}
      aria-label={label}
    >
      <div className="section-label">
        <Text weight="semibold">{label}</Text>
        <Text size={200} className="muted">
          人民币 · 每晚单间
        </Text>
      </div>
      <ol className="night-strip">
        {nights.map((n) => {
          const changed = changedDates?.has(n.date);
          const wd = weekday(n.date);
          const isWeekend = wd === "周六" || wd === "周日";
          return (
            <li
              key={n.date}
              className={[
                changed ? "changed" : "",
                isWeekend ? "weekend" : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined}
            >
              <div className="night-head">
                <span className="night-date">{shortDate(n.date)}</span>
                {changed && (
                  <Badge appearance="tint" color="warning" size="small">
                    变动
                  </Badge>
                )}
              </div>
              <Text size={200} className="muted">
                {wd}
              </Text>
              <Text weight="semibold">{money(n.price)}</Text>
            </li>
          );
        })}
      </ol>
      <div className="quote-total">
        <span>
          {nights.length} 晚 × {rooms} 间<span className="muted"> · 合计</span>
        </span>
        <Price value={total(nights, rooms)} />
      </div>
    </section>
  );
}
export function StaySummary({
  conditions,
  onEdit,
}: {
  conditions: Conditions;
  onEdit?: () => void;
}) {
  return (
    <div className="stay-summary">
      <CalendarLtr24Regular />
      <div>
        <Text weight="semibold">
          {shortDate(conditions.start)} — {shortDate(conditions.end)}
        </Text>
        <div className="muted">
          {days(conditions.start, conditions.end).length} 晚 ·{" "}
          {conditions.people} 人 · {conditions.rooms} 间
        </div>
      </div>
      {onEdit && (
        <Button appearance="subtle" onClick={onEdit}>
          修改条件
        </Button>
      )}
    </div>
  );
}
export function ConditionFields({
  value,
  onChange,
  filters = false,
  showCity = true,
  onDateErrorChange,
}: {
  value: Conditions;
  onChange: (c: Conditions) => void;
  filters?: boolean;
  showCity?: boolean;
  onDateErrorChange?: (error: string) => void;
}) {
  const { data: catalog } = useApp();
  const cityListId = useId();
  const availableCities = useMemo(() => {
    const set = new Set<string>();
    for (const h of catalog.hotels) {
      if (h.enabled && h.city.trim()) set.add(h.city.trim());
    }
    return [...set];
  }, [catalog.hotels]);
  const [peopleText, setPeopleText] = useState(() =>
    value.people > 0 ? String(value.people) : "",
  );
  const dateErrors = useRef({ start: "", end: "" });
  useEffect(() => {
    setPeopleText((curr) => {
      if (value.people <= 0 && curr === "") return "";
      if (Number(curr) === value.people && curr !== "") return curr;
      return value.people > 0 ? String(value.people) : "";
    });
  }, [value.people]);

  const set = <K extends keyof Conditions>(key: K, data: Conditions[K]) =>
    onChange({ ...value, [key]: data });

  const reportDateError = (field: "start" | "end", message: string) => {
    dateErrors.current[field] = message;
    onDateErrorChange?.(dateErrors.current.start || dateErrors.current.end);
  };

  const handleStartChange = (nextStart: string) => {
    if (!isValidIsoDate(nextStart)) {
      set("start", nextStart);
      return;
    }
    const prevLength =
      isValidIsoDate(value.start) && isValidIsoDate(value.end)
        ? days(value.start, value.end).length
        : 2;
    const stayLength = prevLength >= 1 && prevLength <= 14 ? prevLength : 2;
    let nextEnd = value.end;
    if (
      !isValidIsoDate(value.end) ||
      value.end <= nextStart ||
      days(nextStart, value.end).length > 14
    ) {
      nextEnd = addDays(nextStart, stayLength);
    }
    onChange({ ...value, start: nextStart, end: nextEnd });
  };

  const validStart = isValidIsoDate(value.start);
  const validEnd = isValidIsoDate(value.end);
  const nightCount =
    validStart && validEnd && value.end > value.start
      ? days(value.start, value.end).length
      : 0;
  const stayHint =
    nightCount > 0 ? `共 ${nightCount} 晚（最多 14 晚）` : "最多连续 14 晚";
  const trimmedCity = value.city.trim();
  const cityMatched =
    !availableCities.length ||
    !trimmedCity ||
    availableCities.some((c) => c === trimmedCity || c.includes(trimmedCity));

  return (
    <div className="form-grid">
      {showCity && (
        <Field label="目的地城市" className="span-2">
          <Input
            value={value.city}
            onChange={(_, d) => set("city", d.value)}
            placeholder="输入城市"
            list={availableCities.length ? cityListId : undefined}
          />
          {availableCities.length > 0 && (
            <>
              <datalist id={cityListId}>
                {availableCities.map((city) => (
                  <option key={city} value={city} />
                ))}
              </datalist>
              <div
                className="city-suggestions"
                role="group"
                aria-label="可订城市建议"
              >
                {availableCities.map((city) => (
                  <Button
                    key={city}
                    type="button"
                    size="small"
                    appearance={trimmedCity === city ? "primary" : "outline"}
                    onClick={() => set("city", city)}
                  >
                    {city}
                  </Button>
                ))}
              </div>
              {trimmedCity && !cityMatched && (
                <Text size={200} className="muted city-hint">
                  当前可订城市：{availableCities.join("、")}
                </Text>
              )}
            </>
          )}
        </Field>
      )}
      <Field label="入住日期">
        <FluentDatePicker
          value={value.start}
          minDate={TODAY}
          rangeStart={validStart ? value.start : undefined}
          rangeEnd={validEnd ? value.end : undefined}
          rangeHint={stayHint}
          onValidityChange={(msg) => reportDateError("start", msg)}
          onChange={handleStartChange}
        />
      </Field>
      <Field label="离店日期">
        <FluentDatePicker
          value={value.end}
          minDate={validStart ? addDays(value.start, 1) : addDays(TODAY, 1)}
          maxDate={validStart ? addDays(value.start, 14) : undefined}
          rangeStart={validStart ? value.start : undefined}
          rangeEnd={validEnd ? value.end : undefined}
          rangeHint={stayHint}
          onValidityChange={(msg) => reportDateError("end", msg)}
          onChange={(nextEnd) => set("end", nextEnd)}
        />
      </Field>
      <Field label="入住人数">
        <NumericInput
          min={Math.max(1, value.rooms)}
          max={30}
          step={1}
          suffix="人"
          decreaseLabel="减 1 位旅客"
          increaseLabel="加 1 位旅客"
          value={peopleText}
          onChange={(next) => {
            setPeopleText(next);
            set("people", next === "" ? 0 : Number(next));
          }}
        />
      </Field>
      <Field label="房间数">
        <Select
          value={value.rooms}
          onChange={(_, d) => {
            const nextRooms = Number(d.value);
            const nextPeople = Math.max(value.people, nextRooms);
            setPeopleText(String(nextPeople));
            onChange({ ...value, rooms: nextRooms, people: nextPeople });
          }}
        >
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n} 间
            </option>
          ))}
        </Select>
      </Field>
      {filters && (
        <>
          <Field label="房型" className="span-2">
            <Select
              value={value.type}
              onChange={(_, d) => set("type", d.value)}
            >
              <option value="all">全部房型</option>
              {catalog.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="最低每晚价（元）">
            <NumericInput
              decimal
              min={0}
              step={50}
              prefix="¥"
              decreaseLabel="下调最低限价"
              increaseLabel="上调最低限价"
              value={value.min}
              onChange={(next) => set("min", next)}
              placeholder="不限"
            />
          </Field>
          <Field label="最高每晚价（元）">
            <NumericInput
              decimal
              min={0}
              step={50}
              prefix="¥"
              decreaseLabel="下调最高限价"
              increaseLabel="上调最高限价"
              value={value.max}
              onChange={(next) => set("max", next)}
              placeholder="不限"
            />
          </Field>
        </>
      )}
    </div>
  );
}
export function ConditionsDialog({
  open,
  onClose,
  value,
  onApply,
  filters = false,
}: {
  open: boolean;
  onClose: () => void;
  value: Conditions;
  onApply: (c: Conditions) => void;
  filters?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const [dateError, setDateError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open) onClose();
      }}
    >
      {open ? (
        <FocusReturnSurface>
          <DialogBody>
            <DialogTitle>
              {filters ? "筛选住宿条件" : "修改住宿条件"}
            </DialogTitle>
            <DialogContent>
              <p className="muted">
                选择目的地与住宿时间，查找整段可订的房型。
              </p>
              <ConditionFields
                value={draft}
                onChange={(next) => {
                  setDraft(next);
                  if (error) setError("");
                }}
                onDateErrorChange={(msg) => {
                  setDateError(msg);
                  if (!msg && error) setError("");
                }}
                filters={filters}
              />
              {error && (
                <div className="space-top">
                  <Notice intent="error">{error}</Notice>
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>取消</Button>
              <Button
                appearance="primary"
                onClick={() => {
                  if (dateError) {
                    setError(dateError);
                    return;
                  }
                  const message = validConditions(draft);
                  if (message) {
                    setError(message);
                    return;
                  }
                  onApply(draft);
                  onClose();
                }}
              >
                查找酒店
              </Button>
            </DialogActions>
          </DialogBody>
        </FocusReturnSurface>
      ) : (
        <></>
      )}
    </Dialog>
  );
}
export function ConfirmDialog({
  open,
  title,
  children,
  confirm = "确认",
  onClose,
  onConfirm,
  danger = false,
  disabled = false,
  wide = false,
}: PropsWithChildren<{
  open: boolean;
  title: string;
  confirm?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
  wide?: boolean;
}>) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const confirmOnce = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open && !running.current) onClose();
      }}
    >
      {open ? (
        <FocusReturnSurface className={wide ? "wide-dialog" : undefined}>
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>{children}</DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={onClose}>
                返回
              </Button>
              <Button
                appearance="primary"
                className={danger ? "danger-button" : ""}
                onClick={() => void confirmOnce()}
                disabled={disabled || busy}
              >
                {confirm}
              </Button>
            </DialogActions>
          </DialogBody>
        </FocusReturnSurface>
      ) : (
        <></>
      )}
    </Dialog>
  );
}
