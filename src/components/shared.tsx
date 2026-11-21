import { useEffect, useRef, useState } from "react";
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
  days,
  money,
  shortDate,
  total,
  weekday,
  validConditions,
} from "../model";
import type { Conditions, Night, OrderStatus } from "../model";
import { useApp } from "../context";

function FocusReturnSurface({ children }: PropsWithChildren) {
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
  return <DialogSurface>{children}</DialogSurface>;
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
}: {
  nights: Night[];
  rooms?: number;
  compact?: boolean;
  label?: string;
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
        {nights.map((n) => (
          <li key={n.date}>
            <span className="night-date">{shortDate(n.date)}</span>
            <Text size={200} className="muted">
              {weekday(n.date)}
            </Text>
            <Text weight="semibold">{money(n.price)}</Text>
          </li>
        ))}
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
}: {
  value: Conditions;
  onChange: (c: Conditions) => void;
  filters?: boolean;
}) {
  const { data: catalog } = useApp();
  const set = <K extends keyof Conditions>(key: K, data: Conditions[K]) =>
    onChange({ ...value, [key]: data });
  return (
    <div className="form-grid">
      <Field label="目的地城市" className="span-2">
        <Input
          value={value.city}
          onChange={(_, d) => set("city", d.value)}
          placeholder="输入城市"
        />
      </Field>
      <Field label="入住日期">
        <Input
          type="date"
          value={value.start}
          onChange={(_, d) => set("start", d.value)}
        />
      </Field>
      <Field label="离店日期">
        <Input
          type="date"
          value={value.end}
          onChange={(_, d) => set("end", d.value)}
        />
      </Field>
      <Field label="入住人数">
        <Input
          type="number"
          min={1}
          max={6}
          value={String(value.people)}
          onChange={(_, d) => set("people", Number(d.value))}
        />
      </Field>
      <Field label="房间数">
        <Select
          value={value.rooms}
          onChange={(_, d) => set("rooms", Number(d.value))}
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
            <Input
              type="number"
              min={0}
              value={value.min}
              onChange={(_, d) => set("min", d.value)}
              placeholder="不限"
            />
          </Field>
          <Field label="最高每晚价（元）">
            <Input
              type="number"
              min={0}
              value={value.max}
              onChange={(_, d) => set("max", d.value)}
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
              {filters ? "筛选你的住宿" : "这次，想住在哪里？"}
            </DialogTitle>
            <DialogContent>
              <p className="muted">
                选择目的地与住宿时间，查找整段可订的房型。
              </p>
              <ConditionFields
                value={draft}
                onChange={setDraft}
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
}: PropsWithChildren<{
  open: boolean;
  title: string;
  confirm?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
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
        <FocusReturnSurface>
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
