import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  OverlayDrawer,
  Select,
  Switch,
  Spinner,
  Text,
  Textarea,
} from "@fluentui/react-components";
import {
  Add20Regular,
  ArrowDownload20Regular,
  ArrowLeft20Regular,
  ArrowRight20Regular,
  CalendarToday20Regular,
  Dismiss20Regular,
  Edit20Regular,
  Eye20Regular,
} from "@fluentui/react-icons";
import { useApp } from "../context";
import { api, errorMessage, operationKey } from "../api";
import {
  activeStatuses,
  hotelRooms,
  hotelRoom,
  addDays,
  available,
  calendarEntry,
  dateTime,
  days,
  downloadCsv,
  entryKey,
  formatDisplayTime,
  incidentBlocked,
  initialConditions,
  isValidIsoDate,
  money,
  nightState,
  occupied,
  shortDate,
  statistics,
  statuses,
  TODAY,
  total,
  weekday,
} from "../model";
import type {
  CalendarEntry,
  Hotel,
  Incident,
  Order,
  OrderStatus,
  Room,
} from "../model";
import {
  ConfirmDialog,
  Empty,
  Heading,
  NightQuote,
  NightStateBadge,
  Notice,
  Price,
  Status,
} from "../components/shared";
import { FluentDatePicker } from "../components/DateField";
import { NumericInput } from "../components/NumericInput";

export function CalendarPage() {
  const { data, update, audit, notify, staffHotel, connected, command } =
    useApp();
  const hotelName =
    data.hotels.find((h) => h.id === staffHotel)?.name || "酒店";
  const roomsList = hotelRooms(data, staffHotel);
  const baseCalendar = useRef(data.calendar);
  const [start, setStart] = useState(initialConditions.start),
    [focused, setFocused] = useState(initialConditions.start);
  const [edit, setEdit] = useState<{ room: string; date: string } | null>(null);
  const [editStart, setEditStart] = useState(""),
    [editEnd, setEditEnd] = useState(""),
    [amount, setAmount] = useState(""),
    [price, setPrice] = useState(""),
    [stopped, setStopped] = useState(false),
    [error, setError] = useState("");
  const dateErrors = useRef({ start: "", end: "" });
  const week = days(start, addDays(start, 7));

  const loadRoomValues = (roomId: string, targetDate: string) => {
    const safeDate = isValidIsoDate(targetDate) ? targetDate : TODAY;
    const entry = calendarEntry(data, staffHotel, roomId, safeDate);
    setAmount(String(entry.total));
    setPrice(entry.price ? String(entry.price / 100) : "");
    setStopped(entry.version > 0 && entry.stopped);
  };

  const open = (room: string, date: string) => {
    baseCalendar.current = data.calendar;
    dateErrors.current = { start: "", end: "" };
    setEdit({ room, date });
    setEditStart(date);
    setEditEnd(addDays(date, 1));
    loadRoomValues(room, date);
    setError("");
  };

  const switchEditRoom = (nextRoom: string) => {
    if (!edit) return;
    setEdit({ ...edit, room: nextRoom });
    loadRoomValues(nextRoom, editStart || edit.date);
    setError("");
  };

  const handleEditStartChange = (nextStart: string) => {
    if (!isValidIsoDate(nextStart)) {
      setEditStart(nextStart);
      return;
    }
    const prevLength =
      isValidIsoDate(editStart) && isValidIsoDate(editEnd)
        ? days(editStart, editEnd).length
        : 1;
    const span = prevLength >= 1 && prevLength <= 90 ? prevLength : 1;
    let nextEnd = editEnd;
    if (
      !isValidIsoDate(editEnd) ||
      editEnd <= nextStart ||
      days(nextStart, editEnd).length > 90
    ) {
      nextEnd = addDays(nextStart, span);
    }
    setEditStart(nextStart);
    setEditEnd(nextEnd);
    if (error) setError("");
  };

  const save = async () => {
    if (!edit) return;
    if (dateErrors.current.start || dateErrors.current.end) {
      setError(dateErrors.current.start || dateErrors.current.end);
      return;
    }
    if (!isValidIsoDate(editStart) || !isValidIsoDate(editEnd)) {
      setError("请输入有效的公历日期。");
      return;
    }
    const dates = days(editStart, editEnd);
    if (
      !editStart ||
      editStart < TODAY ||
      editEnd <= editStart ||
      dates.length > 90
    ) {
      setError("请选择今天起、连续不超过 90 个住宿日的范围，结束日期不含。");
      return;
    }
    const cleanAmount = amount.trim();
    const cleanPrice = price.trim();
    if (
      !/^\d+$/.test(cleanAmount) ||
      Number(cleanAmount) > 10000 ||
      !/^\d+(\.\d{1,2})?$/.test(cleanPrice) ||
      Number(cleanPrice) <= 0
    ) {
      setError("房量须为 0 至 10000 的整数，价格须大于零且最多保留两位小数。");
      return;
    }
    if (connected) {
      try {
        await command({
          action: "calendar",
          hotel: staffHotel,
          room: edit.room,
          calendar: dates.map((date) => ({
            date,
            total: Number(cleanAmount),
            price: Math.round(Number(cleanPrice) * 100),
            stopped,
            version:
              baseCalendar.current[entryKey(staffHotel, edit.room, date)]
                ?.version || 0,
          })),
        });
        setEdit(null);
        notify("所选日期已一起保存。已有订单的价格快照保持不变。");
      } catch (cause) {
        setError(errorMessage(cause));
      }
      return;
    }
    const conflict = dates.find(
      (date) =>
        occupied(data, staffHotel, edit.room, date) > Number(cleanAmount),
    );
    if (conflict) {
      setError(
        `${shortDate(conflict)}已有 ${occupied(data, staffHotel, edit.room, conflict)} 间有效占用，拟设总量不足；整批未保存。实际无法履约请先登记异常。`,
      );
      return;
    }
    update((current) => {
      const calendar = { ...current.calendar };
      for (const date of dates) {
        const prior = calendarEntry(current, staffHotel, edit.room, date);
        calendar[entryKey(staffHotel, edit.room, date)] = {
          total: Number(cleanAmount),
          price: Math.round(Number(cleanPrice) * 100),
          stopped,
          version: prior.version + 1,
        };
      }
      return { ...current, calendar };
    });
    audit(
      "更新房量价格日历",
      `${staffHotel}/${edit.room}`,
      `${editStart} 至 ${editEnd}（不含）；${dates.length} 个住宿日；总量 ${cleanAmount}；${stopped ? "普通停售" : "可售"}`,
    );
    setEdit(null);
    notify("所选日期已一起保存。已有订单的价格快照保持不变。");
  };
  const cell = (room: Room, date: string) => {
    const entry = calendarEntry(data, staffHotel, room.id, date),
      used = occupied(data, staffHotel, room.id, date),
      sellable = available(data, staffHotel, room.id, date),
      incBlocked = incidentBlocked(data, staffHotel, room.id, date),
      unscheduled = connected && entry.version === 0,
      soldOut =
        sellable === 0 && !incBlocked && !entry.stopped && !unscheduled;
    const statusLabel = incBlocked
      ? "异常停售"
      : unscheduled
        ? "未排期"
        : entry.stopped
          ? "已停售"
          : soldOut
            ? "已满房"
            : `可订 ${sellable} 间`;
    return (
      <Button
        key={`${room.id}-${date}`}
        appearance="subtle"
        className={`day-cell ${sellable === 0 ? "stopped" : ""} ${soldOut ? "sold-out" : ""}`}
        aria-label={`${room.name} ${shortDate(date)}，${money(entry.price)}，可订 ${sellable} 间，编辑`}
        onClick={() => open(room.id, date)}
      >
        <Text size={400} weight="semibold">
          {unscheduled ? "—" : money(entry.price)}
        </Text>
        <span className={`day-status ${sellable === 0 ? "muted" : "available"}`}>
          {statusLabel}
        </span>
        <div className="occupancy-track" aria-hidden="true">
          <div
            className="occupancy-fill"
            style={{
              width: `${entry.total ? Math.min(100, (used / entry.total) * 100) : 0}%`,
            }}
          />
        </div>
        <Text size={200} className="muted">
          占用 {used} / 总量 {entry.total}
        </Text>
      </Button>
    );
  };
  const editDatesCount =
    isValidIsoDate(editStart) && isValidIsoDate(editEnd) && editEnd > editStart
      ? days(editStart, editEnd).length
      : 0;
  return (
    <>
      <div className="workspace-intro">
        <Heading eyebrow={`${hotelName} · 酒店工作台`} title="房量与价格日历">
          在同一张日历中维护每日房量、单间价格与停售状态，点击任意日期格即可编辑。
        </Heading>
        <div className="workspace-note">
          普通停售仅限制新增预订，已承诺订单继续保留。
          <br />
          若实际无法履约，请前往“异常处置”登记事件。
        </div>
      </div>
      <div className="calendar-tools">
        <div className="inline">
          <Button
            icon={<ArrowLeft20Regular />}
            aria-label="前一周"
            disabled={start <= TODAY}
            onClick={() => {
              const next =
                addDays(start, -7) < TODAY ? TODAY : addDays(start, -7);
              setStart(next);
              setFocused(next);
            }}
          />
          <Text size={500} weight="semibold">
            {shortDate(start)} — {shortDate(addDays(start, 6))}
          </Text>
          <Button
            icon={<ArrowRight20Regular />}
            aria-label="后一周"
            onClick={() => {
              setStart(addDays(start, 7));
              setFocused(addDays(start, 7));
            }}
          />
          <Button
            size="small"
            appearance="subtle"
            icon={<CalendarToday20Regular />}
            disabled={start === TODAY}
            onClick={() => {
              setStart(TODAY);
              setFocused(TODAY);
            }}
          >
            回到今天
          </Button>
        </div>
        <div className="inline calendar-tool-actions">
          <div className="calendar-jump">
            <FluentDatePicker
              aria-label="跳转至指定周起始日"
              value={start}
              minDate={TODAY}
              onChange={(next) => {
                if (isValidIsoDate(next) && next >= TODAY) {
                  setStart(next);
                  setFocused(next);
                }
              }}
            />
          </div>
          <Button
            appearance="primary"
            icon={<Edit20Regular />}
            disabled={!roomsList.length}
            onClick={() => roomsList[0] && open(roomsList[0].id, start)}
          >
            批量维护日期
          </Button>
        </div>
      </div>
      {roomsList.length ? (
        <>
          <section className="calendar-board" aria-label="一周房量价格日历">
            <div className="calendar-heading">房型 / 住宿日</div>
            {week.map((date) => {
              const wd = weekday(date);
              const isWeekend = wd === "周六" || wd === "周日";
              return (
                <div
                  className={`calendar-heading ${date === TODAY ? "is-today" : ""} ${isWeekend ? "is-weekend" : ""}`}
                  key={date}
                >
                  <Text weight="semibold">{shortDate(date)}</Text>
                  <p className="muted">
                    {date === TODAY ? `今天 · ${wd}` : wd}
                  </p>
                </div>
              );
            })}
            {roomsList.map((room) => (
              <div style={{ display: "contents" }} key={room.id}>
                <div className="calendar-room">
                  <Text weight="semibold">{room.name}</Text>
                  <Text size={200} className="muted">
                    {room.size} m² · {room.capacity} 人 / 间
                  </Text>
                </div>
                {week.map((date) => cell(room, date))}
              </div>
            ))}
          </section>
          <section className="mobile-calendar" aria-label="按日查看房量">
            <Field label="查看住宿日">
              <Select value={focused} onChange={(_, d) => setFocused(d.value)}>
                {week.map((date) => (
                  <option key={date} value={date}>
                    {shortDate(date)} · {weekday(date)}
                  </option>
                ))}
              </Select>
            </Field>
            {roomsList.map((room) => {
              const entry = calendarEntry(data, staffHotel, room.id, focused);
              const sellable = available(data, staffHotel, room.id, focused);
              return (
                <article className="room-edit-row" key={room.id}>
                  <div>
                    <Text size={400} weight="semibold">
                      {room.name}
                    </Text>
                    <p className="space-top">
                      <Price value={entry.price} />
                    </p>
                    <p className="muted">
                      可订 {sellable} · 剩余{" "}
                      {entry.total - occupied(data, staffHotel, room.id, focused)} ·
                      总量 {entry.total}
                    </p>
                  </div>
                  <Button onClick={() => open(room.id, focused)}>编辑</Button>
                </article>
              );
            })}
          </section>
        </>
      ) : (
        <Empty title="暂无可排期房型">
          请先在“酒店与房型”页面新增房型后再设置每日房量与价格。
        </Empty>
      )}
      <div className="legend">
        <span>
          每晚单间价 · 人民币　／　占用条包含预占、承诺、在住占用与已消费
        </span>
        <span>结束日期不计入住宿日</span>
      </div>
      <ConfirmDialog
        open={Boolean(edit)}
        title="维护房量与价格"
        confirm="保存所选日期"
        onClose={() => setEdit(null)}
        onConfirm={save}
      >
        <p className="muted">
          批量调整房量、每晚价格与停售状态；已有订单的价格快照保持不变。
        </p>
        <div className="form-grid space-top">
          <Field label="房型" className="span-2">
            <Select
              value={edit?.room || ""}
              onChange={(_, d) => switchEditRoom(d.value)}
            >
              {roomsList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {!r.enabled ? "（已停用）" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="住宿日起">
            <FluentDatePicker
              value={editStart}
              minDate={TODAY}
              rangeStart={isValidIsoDate(editStart) ? editStart : undefined}
              rangeEnd={isValidIsoDate(editEnd) ? editEnd : undefined}
              rangeHint={
                editDatesCount > 0 ? `共 ${editDatesCount} 个住宿日` : undefined
              }
              onValidityChange={(msg) => {
                dateErrors.current.start = msg;
              }}
              onChange={handleEditStartChange}
            />
          </Field>
          <Field label="住宿日止（不含）">
            <FluentDatePicker
              value={editEnd}
              minDate={
                isValidIsoDate(editStart)
                  ? addDays(editStart, 1)
                  : addDays(TODAY, 1)
              }
              maxDate={
                isValidIsoDate(editStart) ? addDays(editStart, 90) : undefined
              }
              rangeStart={isValidIsoDate(editStart) ? editStart : undefined}
              rangeEnd={isValidIsoDate(editEnd) ? editEnd : undefined}
              rangeHint={
                editDatesCount > 0
                  ? `含 ${editDatesCount} 晚（最多 90 晚）`
                  : "最多连续 90 晚"
              }
              onValidityChange={(msg) => {
                dateErrors.current.end = msg;
              }}
              onChange={(nextEnd) => {
                setEditEnd(nextEnd);
                if (error) setError("");
              }}
            />
          </Field>
          <Field label="每日可售总量">
            <NumericInput
              min={0}
              max={10000}
              step={1}
              suffix="间"
              decreaseLabel="下调可售房量"
              increaseLabel="上调可售房量"
              value={amount}
              onChange={(next) => {
                setAmount(next);
                if (error) setError("");
              }}
            />
          </Field>
          <Field label="每晚单间价（元）">
            <NumericInput
              decimal
              min={0.01}
              max={100000}
              step={10}
              prefix="¥"
              decreaseLabel="降价 10 元"
              increaseLabel="加价 10 元"
              value={price}
              onChange={(next) => {
                setPrice(next);
                if (error) setError("");
              }}
            />
          </Field>
          {editDatesCount > 0 && (
            <Text size={200} className="muted span-2">
              将更新 {editDatesCount} 个住宿日（{shortDate(editStart)} —{" "}
              {shortDate(editEnd)}，不含止日）。
            </Text>
          )}
          <Switch
            className="span-2"
            checked={stopped}
            onChange={(_, d) => setStopped(d.checked)}
            label="普通停售：限制新预订，保留旧订单"
          />
        </div>
        {error && (
          <div className="space-top">
            <Notice intent="error">{error}</Notice>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

function OrderDrawer({
  order,
  onClose,
  readOnly = false,
  incidentId,
}: {
  order?: Order;
  onClose: () => void;
  readOnly?: boolean;
  incidentId?: string;
}) {
  return (
    <OverlayDrawer
      className="order-drawer"
      position="end"
      size="medium"
      open={Boolean(order)}
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DrawerHeader className="order-drawer-header">
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              icon={<Dismiss20Regular />}
              aria-label={readOnly ? "关闭关联订单" : "关闭订单详情"}
              onClick={onClose}
            />
          }
        >
          {readOnly ? "关联订单" : "订单详情"}
        </DrawerHeaderTitle>
        <Text className="order-number">{order?.id}</Text>
      </DrawerHeader>
      {order && (
        <OrderInspector
          key={order.id}
          order={order}
          readOnly={readOnly}
          incidentId={incidentId}
        />
      )}
    </OverlayDrawer>
  );
}

function OrderInspector({
  order,
  readOnly = false,
  incidentId,
}: {
  order: Order;
  readOnly?: boolean;
  incidentId?: string;
}) {
  const { data, update, audit, notify, role, connected, command } = useApp();
  const [action, setAction] = useState<OrderStatus | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [contactOpen, setContactOpen] = useState(false),
    [purpose, setPurpose] = useState(""),
    [revealed, setRevealed] = useState(false);
  const [fullPhone, setFullPhone] = useState("");
  const retry = useRef({ input: "", key: "" });
  const [busy, setBusy] = useState(false);
  const related = incidentId || order.incident;
  const hotel = data.hotels.find((h) => h.id === order.hotel)!,
    room = hotelRoom(data, order.hotel, order.room);
  const blocked = Boolean(
    order.incident &&
    !data.incidents.find((i) => i.id === order.incident)?.closed,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (order.status !== "待确认") return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [order.id, order.status]);
  const checkinEnds = Date.parse(`${order.end}T12:00:00+08:00`);
  const canCheckin =
    now >= Date.parse(`${order.start}T14:00:00+08:00`) && now < checkinEnds;
  const canProcess =
    !readOnly &&
    (!blocked || (connected && order.status === "已入住")) &&
    (order.status === "待确认" ||
      order.status === "已确认" ||
      order.status === "已入住");
  const expiredPrivacy = connected
    ? Boolean(order.terminalAt && now >= order.terminalAt + 7 * 86400000)
    : !order.phone;
  const transition = async (status: OrderStatus) => {
    if (busy) return;
    if ((status === "已拒绝" || status === "已取消") && !reason.trim()) {
      setError("请填写处理原因。");
      return;
    }
    if (connected) {
      const input = JSON.stringify([status, reason]);
      if (retry.current.input !== input)
        retry.current = { input, key: operationKey() };
      setBusy(true);
      try {
        await command({
          action: "transition",
          id: order.id,
          mode: status,
          note: reason,
          key: retry.current.key,
        });
        setAction(null);
        setReason("");
        notify("处理结果已更新。");
      } catch (cause) {
        setError(errorMessage(cause));
        if (!action) notify(errorMessage(cause), "error");
      } finally {
        setBusy(false);
      }
      return;
    }
    const permitted: Record<string, OrderStatus[]> = {
      待确认: ["已确认", "已拒绝"],
      已确认: ["已入住"],
      已入住: ["已退房"],
    };
    if (
      !permitted[order.status]?.includes(status) ||
      (order.status === "待确认" && order.deadline <= Date.now())
    ) {
      notify("订单状态已更新，请查回最新结果。", "warning");
      setAction(null);
      return;
    }
    update((current) => ({
      ...current,
      orders: current.orders.map((o) =>
        o.id === order.id
          ? {
              ...o,
              status,
              ...(["已退房", "已拒绝", "已取消", "已超时"].includes(status)
                ? { terminalAt: Date.now() }
                : {}),
              ...(status === "已退房"
                ? { checkout: new Date().toISOString() }
                : {}),
              history: [
                ...o.history,
                {
                  time: dateTime(),
                  text: `酒店${status === "已确认" ? "确认预订" : status === "已入住" ? "办理入住" : status === "已退房" ? "据实办理退房" : `拒绝预订：${reason}`}`,
                },
              ],
            }
          : o,
      ),
    }));
    audit(
      status === "已确认"
        ? "确认订单"
        : status === "已入住"
          ? "办理入住"
          : status === "已退房"
            ? "办理退房"
            : "拒绝订单",
      order.id,
      `${order.status} → ${status}${reason ? "；已登记处理原因" : ""}`,
    );
    setAction(null);
    setReason("");
    notify("处理结果已更新。");
  };
  return (
    <>
      <DrawerBody
        className="order-drawer-body"
        role="region"
        aria-label="订单明细"
        tabIndex={0}
      >
        <div className="drawer-content">
          <div className="order-title">
            <Text size={600} weight="semibold">
              {hotel.name}
            </Text>
            <Status status={order.status} />
          </div>
          <Text>{room.name}</Text>
          {blocked && (
            <Notice intent="warning">
              订单关联 {order.incident}
              ，请从异常事件逐单处置；当前占用继续保留。
            </Notice>
          )}
          {order.status === "待确认" && (
            <Notice>
              确认截止 {dateTime(order.deadline)}，约剩{" "}
              {Math.max(0, Math.ceil((order.deadline - Date.now()) / 60000))}{" "}
              分钟。
            </Notice>
          )}
          <div className="facts">
            <div className="fact">
              <span className="fact-label">入住 — 离店</span>
              <div className="fact-value">
                {shortDate(order.start)} — {shortDate(order.end)}
              </div>
            </div>
            <div className="fact">
              <span className="fact-label">人数与房量</span>
              <div className="fact-value">
                {order.people} 人 · {order.rooms} 间
              </div>
            </div>
            <div className="fact">
              <span className="fact-label">联系人</span>
              <div className="fact-value">
                {revealed && !connected
                  ? order.name
                  : expiredPrivacy
                    ? "已到期清理"
                    : "按需查看"}
              </div>
            </div>
            <div className="fact">
              <span className="fact-label">联系手机</span>
              <div className="fact-value">
                {expiredPrivacy
                  ? "完整信息已到期"
                  : revealed
                    ? connected
                      ? fullPhone
                      : order.phone
                    : `尾号 ${order.phoneTail || order.phone?.slice(-4) || "—"}`}
              </div>
            </div>
          </div>
          <Button
            icon={<Eye20Regular />}
            disabled={expiredPrivacy || (role === "admin" && !related)}
            onClick={() => {
              setPurpose(connected && role === "admin" ? "incident" : "");
              setError("");
              setContactOpen(true);
            }}
          >
            登记用途并查看联系方式
          </Button>
          {role === "admin" && !related && (
            <Text size={200} className="muted">
              管理员仅可为已关联的异常调查查看完整联系方式。
            </Text>
          )}
          <NightQuote
            nights={order.nights}
            rooms={order.rooms}
            label="保存的逐晚报价"
          />
          <section>
            <Text as="h3" size={400} weight="semibold">
              处理记录
            </Text>
            <ol className="timeline space-top">
              {[...order.history].reverse().map((e, i) => (
                <li key={i}>
                  <time>{e.time}</time>
                  {e.text}
                </li>
              ))}
            </ol>
          </section>
          {canProcess && order.status === "已确认" && !canCheckin && (
            <Text className="muted">
              入住日 14:00 起、离店日 12:00
              前可办理。超出窗口请联系顾客并登记实际情况。
            </Text>
          )}
        </div>
      </DrawerBody>
      {canProcess && (
        <DrawerFooter className="order-drawer-actions">
          {order.status === "待确认" && (
            <>
              <Button
                appearance="primary"
                disabled={order.deadline <= now || busy}
                onClick={() => transition("已确认")}
              >
                确认接单
              </Button>
              <Button
                onClick={() => {
                  setError("");
                  setReason("");
                  setAction("已拒绝");
                }}
              >
                拒绝并说明原因
              </Button>
            </>
          )}
          {order.status === "已确认" && (
            <>
              <Button
                appearance="primary"
                disabled={!canCheckin}
                onClick={() => {
                  setError("");
                  setAction("已入住");
                }}
              >
                办理入住
              </Button>
              {connected && now >= checkinEnds && (
                <Button
                  onClick={() => {
                    setReason("");
                    setError("");
                    setAction("已取消");
                  }}
                >
                  登记未到店并取消
                </Button>
              )}
            </>
          )}
          {order.status === "已入住" && (
            <Button
              appearance="primary"
              onClick={() => {
                setError("");
                setAction("已退房");
              }}
            >
              办理退房
            </Button>
          )}
        </DrawerFooter>
      )}
      <ConfirmDialog
        danger={action === "已拒绝" || action === "已取消"}
        open={Boolean(action)}
        title={
          action === "已取消"
            ? "登记未到店并取消"
            : action === "已拒绝"
              ? "拒绝这笔预订"
              : action === "已入住"
                ? "确认办理入住"
                : "确认实际退房"
        }
        confirm={
          action === "已退房"
            ? "登记实际退房"
            : action === "已入住"
              ? "确认入住"
              : action === "已取消"
                ? "确认取消订单"
                : "提交拒绝结果"
        }
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (action) return transition(action);
        }}
      >
        {action === "已拒绝" || action === "已取消" ? (
          <Field
            label={action === "已取消" ? "未到店原因" : "拒绝原因"}
            required
          >
            <Textarea value={reason} onChange={(_, d) => setReason(d.value)} />
          </Field>
        ) : action === "已入住" ? (
          <p>
            已在线下核实到店事实。确认后将已有承诺转为在住占用，不增加房量。
          </p>
        ) : (
          <>
            <p>
              实际办理时间：{dateTime()}
              （北京时间）。逐晚记录将按实际退房时点结转。
            </p>
            <div className="stack space-top">
              {order.nights.map((n) => (
                <div className="section-label" key={n.date}>
                  <span>{shortDate(n.date)}</span>
                  <NightStateBadge
                    state={nightState(
                      {
                        ...order,
                        occupancy: undefined,
                        status: "已退房",
                        checkout: new Date().toISOString(),
                      },
                      n.date,
                    )}
                  />
                </div>
              ))}
            </div>
            <p className="muted">原订单报价保留；释放间夜不表示平台退款。</p>
          </>
        )}
        {error && <Notice intent="error">{error}</Notice>}
      </ConfirmDialog>
      <ConfirmDialog
        open={contactOpen}
        title="按用途查看联系方式"
        confirm="登记用途并查看"
        onClose={() => setContactOpen(false)}
        onConfirm={async () => {
          if (!purpose.trim()) {
            setError("请填写具体的联系用途。");
            return;
          }
          if (connected) {
            try {
              const value = await command({
                action: "contact",
                id: order.id,
                note: purpose,
                incident: related ? { id: related } : undefined,
              });
              setFullPhone(value.phone || "");
              setRevealed(true);
              setContactOpen(false);
            } catch (cause) {
              setError(errorMessage(cause));
            }
            return;
          }
          setRevealed(true);
          setContactOpen(false);
          audit(
            "查看完整联系方式",
            order.id,
            `履约用途已登记${order.incident ? `；关联 ${order.incident}` : ""}`,
          );
        }}
      >
        <p className="muted">
          本次查看会记录到操作日志。
          {role === "admin"
            ? `关联异常：${related}`
            : "仅限所属酒店订单的确认与履约。"}
        </p>
        <Field label="查看用途" required className="space-top">
          {connected ? (
            <Select value={purpose} onChange={(_, d) => setPurpose(d.value)}>
              <option value="">选择联系用途</option>
              {role === "staff" && (
                <>
                  <option value="booking">预订确认</option>
                  <option value="stay">入住与退房</option>
                </>
              )}
              <option value="incident">履约异常调查</option>
            </Select>
          ) : (
            <Textarea
              value={purpose}
              onChange={(_, d) => setPurpose(d.value)}
              placeholder="例如：联系顾客核实到店时间"
            />
          )}
        </Field>
        {error && (
          <div className="space-top">
            <Notice intent="error">{error}</Notice>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

export function StaffOrders() {
  const { data, staffHotel, connected } = useApp();
  const hotelName =
    data.hotels.find((h) => h.id === staffHotel)?.name || "酒店";
  const [state, setState] = useState("all"),
    [room, setRoom] = useState("all"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [offset, setOffset] = useState(0);
  const [remote, setRemote] = useState<Order[]>([]);
  const [queryError, setQueryError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setOffset(0), [start, end, room, state, search]);
  useEffect(() => {
    if (!connected) return;
    let current = true;
    void api
      .orders({
        room: room === "all" ? "" : room,
        status: state === "all" ? "" : state,
        start,
        end,
        search,
        limit: 20,
        offset,
      })
      .then((orders) => {
        if (current) {
          setRemote(orders);
          setQueryError("");
        }
      })
      .catch((cause) => {
        if (current) {
          setRemote([]);
          setQueryError(errorMessage(cause));
        }
      });
    return () => {
      current = false;
    };
  }, [connected, start, end, room, state, search, offset, data.orders]);
  const orders = connected
    ? remote
    : data.orders
        .filter(
          (o) =>
            o.hotel === staffHotel &&
            (state === "all" || o.status === state) &&
            (room === "all" || o.room === room) &&
            (!start || o.start >= start) &&
            (!end || o.start < end) &&
            o.id.toLowerCase().includes(search.toLowerCase()),
        )
        .sort(
          (a, b) =>
            Number(b.status === "待确认") - Number(a.status === "待确认") ||
            b.created - a.created ||
            a.id.localeCompare(b.id),
        );
  const current =
    (connected ? remote.find((o) => o.id === selected) : undefined) ||
    data.orders.find((o) => o.id === selected && o.hotel === staffHotel);
  const pendingCount = data.orders.filter(
    (o) => o.hotel === staffHotel && o.status === "待确认",
  ).length;
  const hasFilters =
    state !== "all" ||
    room !== "all" ||
    search !== "" ||
    start !== "" ||
    end !== "";
  const resetFilters = () => {
    setState("all");
    setRoom("all");
    setSearch("");
    setStart("");
    setEnd("");
  };
  return (
    <>
      <Heading
        eyebrow={`${hotelName} · 酒店工作台`}
        title="订单处理"
        action={
          <Button
            appearance={state === "待确认" ? "primary" : "outline"}
            size="small"
            onClick={() => setState(state === "待确认" ? "all" : "待确认")}
          >
            {pendingCount > 0 && state !== "待确认" && (
              <span className="pending-dot" aria-hidden="true" />
            )}
            {pendingCount} 笔待确认
          </Button>
        }
      >
        先处理即将到期的待确认预订，再核验入住与退房。
      </Heading>
      <div className="quick-filter-bar" role="group" aria-label="快捷状态筛选">
        {(
          [
            ["all", "全部订单"],
            ["待确认", `待确认 (${pendingCount})`],
            ["已确认", "已确认"],
            ["已入住", "已入住"],
          ] as const
        ).map(([val, label]) => (
          <Button
            key={val}
            size="small"
            appearance={state === val ? "primary" : "subtle"}
            onClick={() => setState(val)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="filter-bar">
        <Field label="查找订单编号">
          <Input
            value={search}
            onChange={(_, d) => setSearch(d.value)}
            placeholder="输入订单编号"
          />
        </Field>
        <Field label="订单状态">
          <Select value={state} onChange={(_, d) => setState(d.value)}>
            <option value="all">全部状态</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="房型">
          <Select value={room} onChange={(_, d) => setRoom(d.value)}>
            <option value="all">全部房型</option>
            {hotelRooms(data, staffHotel).map((r) => (
              <option value={r.id} key={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="入住日起">
          <FluentDatePicker
            clearable
            value={start}
            rangeStart={isValidIsoDate(start) ? start : undefined}
            rangeEnd={isValidIsoDate(end) ? end : undefined}
            onChange={(next) => {
              setStart(next);
              if (next && end && end <= next) setEnd(addDays(next, 1));
            }}
          />
        </Field>
        <Field label="入住日止（不含）">
          <FluentDatePicker
            clearable
            value={end}
            minDate={isValidIsoDate(start) ? addDays(start, 1) : undefined}
            rangeStart={isValidIsoDate(start) ? start : undefined}
            rangeEnd={isValidIsoDate(end) ? end : undefined}
            onChange={setEnd}
          />
        </Field>
        {hasFilters && (
          <Button appearance="subtle" onClick={resetFilters}>
            重置筛选
          </Button>
        )}
      </div>
      {queryError && <Notice intent="error">{queryError}</Notice>}
      {orders.length ? (
        <div className="table-wrap staff-order-table">
          <table>
            <thead>
              <tr>
                <th>订单 / 房型</th>
                <th>住宿安排</th>
                <th>订单状态</th>
                <th>报价总额</th>
                <th>联系手机</th>
                <th>处理</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td data-label="订单 / 房型">
                    <div className="staff-order-id">{o.id}</div>
                    <Text size={200} className="muted">
                      {
                        hotelRooms(data, staffHotel).find(
                          (r) => r.id === o.room,
                        )?.name
                      }
                    </Text>
                  </td>
                  <td data-label="住宿安排">
                    <div>
                      {shortDate(o.start)} — {shortDate(o.end)}
                      <br />
                      <span className="muted">
                        {o.people} 人 · {o.rooms} 间
                      </span>
                    </div>
                  </td>
                  <td data-label="订单状态">
                    <div>
                      <Status status={o.status} />
                      {o.status === "待确认" && (
                        <div className="subtle">
                          剩{" "}
                          {Math.max(0, Math.ceil((o.deadline - now) / 60000))}{" "}
                          分钟
                        </div>
                      )}
                      {o.incident && <div className="subtle">异常处置中</div>}
                    </div>
                  </td>
                  <td data-label="报价总额">
                    {money(total(o.nights, o.rooms))}
                  </td>
                  <td data-label="联系手机">
                    {`尾号 ${o.phoneTail || o.phone?.slice(-4) || "—"}`}
                    {(connected
                      ? Boolean(
                          o.terminalAt && now >= o.terminalAt + 7 * 86400000,
                        )
                      : !o.phone) && " · 已到期"}
                  </td>
                  <td data-label="处理">
                    <Button onClick={() => setSelected(o.id)}>
                      查看与处理
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="没有符合条件的订单"
          action={
            hasFilters ? (
              <Button onClick={resetFilters}>重置筛选</Button>
            ) : undefined
          }
        >
          请调整状态、房型、日期或订单编号。
        </Empty>
      )}
      {connected && (offset > 0 || orders.length === 20) && (
        <div className="button-row space-top">
          <Button disabled={!offset} onClick={() => setOffset(offset - 20)}>
            上一页
          </Button>
          <Button
            disabled={orders.length !== 20}
            onClick={() => setOffset(offset + 20)}
          >
            下一页
          </Button>
        </div>
      )}
      <OrderDrawer order={current} onClose={() => setSelected("")} />
    </>
  );
}

export function HotelSettings() {
  const { data, update, audit, notify, staffHotel, connected, command } =
    useApp();
  const hotel = data.hotels.find((h) => h.id === staffHotel);
  const [draft, setDraft] = useState<Hotel>(() =>
      hotel || {
        id: staffHotel,
        name: "",
        city: "",
        address: "",
        district: "",
        image: "",
        caption: "",
        description: "",
        offset: 0,
        enabled: true,
        phone: "",
      },
    ),
    [error, setError] = useState(""),
    [editRoom, setEditRoom] = useState<Room | null>(null),
    [isNewRoom, setIsNewRoom] = useState(false),
    [roomCapacity, setRoomCapacity] = useState("2"),
    [roomSize, setRoomSize] = useState("32"),
    [roomError, setRoomError] = useState("");
  useEffect(() => {
    if (hotel) setDraft(hotel);
  }, [
    hotel?.id,
    hotel?.name,
    hotel?.city,
    hotel?.address,
    hotel?.phone,
    hotel?.description,
  ]);
  if (!hotel) return <Empty title="未找到所属酒店资料" />;
  const openRoomModal = (room: Room, creating: boolean) => {
    setRoomError("");
    setIsNewRoom(creating);
    setEditRoom(room);
    setRoomCapacity(String(room.capacity));
    setRoomSize(String(room.size));
  };
  const save = async () => {
    if (
      ![draft.name, draft.city, draft.address, draft.phone].every((v) =>
        v.trim(),
      )
    ) {
      setError("酒店名称、城市、地址和联系电话均需填写。");
      return;
    }
    if (connected) {
      const { name, city, address, phone, description } = draft;
      try {
        await command({
          action: "hotel",
          hotel: staffHotel,
          property: { name, city, address, phone, description },
        });
        setError("");
        notify("酒店资料已保存。");
      } catch (cause) {
        setError(errorMessage(cause));
      }
      return;
    }
    update((current) => ({
      ...current,
      hotels: current.hotels.map((h) =>
        h.id === staffHotel
          ? {
              ...h,
              name: draft.name.trim(),
              city: draft.city.trim(),
              address: draft.address.trim(),
              phone: draft.phone.trim(),
              description: draft.description.trim(),
            }
          : h,
      ),
    }));
    setError("");
    audit("维护酒店资料", staffHotel, "更新名称、城市、地址、联系电话或简介");
    notify("酒店资料已保存。");
  };
  return (
    <>
      <Heading
        eyebrow={`${hotel.name} · 酒店工作台`}
        title="酒店与房型资料"
        action={
          <Button
            appearance="primary"
            icon={<Add20Regular />}
            onClick={() => {
              openRoomModal(
                {
                  id: connected ? "" : `RM${Date.now()}`,
                  hotel: staffHotel,
                  name: "",
                  price: 46800,
                  capacity: 2,
                  size: 32,
                  bed: "1 张 1.8m 大床",
                  description: "",
                  enabled: true,
                },
                true,
              );
            }}
          >
            新增房型
          </Button>
        }
      >
        维护所属酒店的基本信息与房型说明；预订按房型进行，不分配具体房号。
      </Heading>
      <div className="settings-grid">
        <section className="settings-section">
          <Text as="h2" size={500} weight="semibold">
            酒店资料
          </Text>
          <div className="form-grid">
            {(["name", "city", "address", "phone"] as const).map((key, i) => (
              <Field
                label={["酒店名称", "所在城市", "详细地址", "联系电话"][i]}
                key={key}
                className={key === "address" ? "span-2" : ""}
              >
                <Input
                  value={draft[key]}
                  onChange={(_, d) => setDraft({ ...draft, [key]: d.value })}
                />
              </Field>
            ))}
            <Field label="酒店简介" className="span-2">
              <Textarea
                value={draft.description}
                onChange={(_, d) =>
                  setDraft({ ...draft, description: d.value })
                }
                rows={3}
              />
            </Field>
          </div>
          {error && (
            <div className="space-top">
              <Notice intent="error">{error}</Notice>
            </div>
          )}
          <Button appearance="primary" className="space-top" onClick={save}>
            保存酒店资料
          </Button>
        </section>
        <section className="settings-section">
          <Text as="h2" size={500} weight="semibold">
            房型资料
          </Text>
          {hotelRooms(data, staffHotel).map((r) => (
            <article className="room-edit-row" key={r.id}>
              <div>
                <div className="inline">
                  <Text weight="semibold">{r.name}</Text>
                  <Badge
                    appearance="tint"
                    color={r.enabled ? "success" : "subtle"}
                  >
                    {r.enabled ? "启用" : "停用"}
                  </Badge>
                </div>
                <p className="muted space-top">
                  {r.size} m² · {r.bed} · 每间可住 {r.capacity} 人
                </p>
                <p className="muted">{r.description}</p>
              </div>
              <Button onClick={() => openRoomModal({ ...r }, false)}>
                编辑
              </Button>
            </article>
          ))}
          <p className="muted space-top">
            有订单引用的房型保留历史，可停用；逐日价格与房量在日历中维护。
          </p>
        </section>
      </div>
      <ConfirmDialog
        open={Boolean(editRoom)}
        title={isNewRoom ? "新增房型" : "编辑房型资料"}
        confirm="保存房型"
        onClose={() => setEditRoom(null)}
        onConfirm={async () => {
          if (!editRoom) return;
          const cap = Number(roomCapacity.trim());
          const area = Number(roomSize.trim());
          if (
            !editRoom.name.trim() ||
            !/^\d+$/.test(roomCapacity.trim()) ||
            cap < 1 ||
            cap > 100 ||
            !/^\d+$/.test(roomSize.trim()) ||
            area < 1 ||
            area > 10000
          ) {
            setRoomError(
              "请填写房型名称，每间可住人数与房间面积须为正整数。",
            );
            return;
          }
          const nextRoom: Room = { ...editRoom, capacity: cap, size: area };
          if (connected) {
            const { name, capacity, size, bed, description, enabled } =
              nextRoom;
            try {
              await command({
                action: "room",
                hotel: staffHotel,
                room: nextRoom.id,
                roomType: { name, capacity, size, bed, description, enabled },
              });
              setEditRoom(null);
              notify("房型资料已保存。");
            } catch (cause) {
              setRoomError(errorMessage(cause));
            }
            return;
          }
          if (
            hotelRooms(data, staffHotel).some(
              (r) =>
                r.id !== nextRoom.id &&
                r.enabled &&
                r.name.trim() === nextRoom.name.trim(),
            )
          ) {
            setRoomError("本酒店已有同名有效房型。");
            return;
          }
          update((current) => ({
            ...current,
            rooms: current.rooms.some((r) => r.id === nextRoom.id)
              ? current.rooms
              : [...current.rooms, nextRoom],
            roomDetails: {
              ...current.roomDetails,
              [`${staffHotel}/${nextRoom.id}`]: nextRoom,
            },
          }));
          audit(
            "维护房型",
            `${staffHotel}/${nextRoom.id}`,
            "更新房型说明、容量或启停",
          );
          setEditRoom(null);
          notify("房型资料已保存。");
        }}
      >
        {editRoom && (
          <div className="form-grid">
            <Field label="房型名称" className="span-2">
              <Input
                value={editRoom.name}
                onChange={(_, d) => setEditRoom({ ...editRoom, name: d.value })}
              />
            </Field>
            <Field label="每间可住人数">
              <NumericInput
                min={1}
                max={100}
                step={1}
                suffix="人"
                decreaseLabel="减少容量"
                increaseLabel="增加容量"
                value={roomCapacity}
                onChange={setRoomCapacity}
              />
            </Field>
            <Field label="房间面积（m²）">
              <NumericInput
                min={1}
                max={10000}
                step={1}
                suffix="m²"
                decreaseLabel="减小面积"
                increaseLabel="增大面积"
                value={roomSize}
                onChange={setRoomSize}
              />
            </Field>
            <Field label="床型说明" className="span-2">
              <Input
                value={editRoom.bed}
                onChange={(_, d) => setEditRoom({ ...editRoom, bed: d.value })}
              />
            </Field>
            <Field label="房型描述" className="span-2">
              <Textarea
                value={editRoom.description}
                onChange={(_, d) =>
                  setEditRoom({ ...editRoom, description: d.value })
                }
              />
            </Field>
            <Switch
              checked={editRoom.enabled}
              onChange={(_, d) =>
                setEditRoom({ ...editRoom, enabled: d.checked })
              }
              label="启用房型"
              className="span-2"
            />
            {roomError && (
              <div className="span-2">
                <Notice intent="error">{roomError}</Notice>
              </div>
            )}
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

export function StatsPage() {
  const { data, audit, staffHotel, connected, command } = useApp();
  const hotelName =
    data.hotels.find((h) => h.id === staffHotel)?.name || "酒店";
  const [loaded, setLoaded] = useState(!connected);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState(initialConditions.start),
    [end, setEnd] = useState(addDays(initialConditions.start, 7)),
    [room, setRoom] = useState("all"),
    [error, setError] = useState(""),
    [page, setPage] = useState(0);
  const [snapshot, setSnapshot] = useState(() => ({
    ...statistics(data, staffHotel, start, end, room),
    at: dateTime(),
    start,
    end,
    room,
  }));
  useEffect(() => {
    if (!connected) return;
    let current = true;
    void api
      .stats(
        initialConditions.start,
        addDays(initialConditions.start, 7),
        "all",
      )
      .then((value) => {
        if (current) {
          setSnapshot(value);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (current) setError(errorMessage(cause));
      });
    return () => {
      current = false;
    };
  }, [connected, staffHotel]);
  const statsDateErrors = useRef({ start: "", end: "" });
  const refresh = async () => {
    if (statsDateErrors.current.start || statsDateErrors.current.end) {
      setError(statsDateErrors.current.start || statsDateErrors.current.end);
      return;
    }
    if (
      !isValidIsoDate(start) ||
      !isValidIsoDate(end) ||
      end <= start ||
      days(start, end).length > 90
    ) {
      setError("请选取连续 1 至 90 个住宿日，结束日期不含。");
      return;
    }
    if (connected) {
      setBusy(true);
      try {
        setSnapshot(await api.stats(start, end, room));
        setLoaded(true);
        setPage(0);
        setError("");
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
      return;
    }
    setSnapshot({
      ...statistics(data, staffHotel, start, end, room),
      at: dateTime(),
      start,
      end,
      room,
    });
    setPage(0);
    setError("");
  };
  const exportData = async () => {
    if (connected) {
      try {
        await command({ action: "stats_export", hotel: staffHotel });
      } catch (cause) {
        setError(errorMessage(cause));
        return;
      }
    }
    downloadCsv(`${hotelName}-有效间夜-${snapshot.start}.csv`, [
      [
        "统计时点",
        "酒店",
        "住宿日起",
        "住宿日止(不含)",
        "房型筛选",
        "订单编号",
        "住宿日",
        "房型",
        "间数",
        "订单状态",
        "逐晚状态",
        "逐晚单间价(元)",
        "有效间夜约定金额(元)",
      ],
      ...snapshot.rows.map((row) => [
        snapshot.at,
        staffHotel,
        snapshot.start,
        snapshot.end,
        snapshot.room,
        row.order,
        row.date,
        row.room,
        row.rooms,
        row.status,
        row.state,
        (row.price / 100).toFixed(2),
        (row.effective / 100).toFixed(2),
      ]),
    ]);
    if (!connected)
      audit(
        "导出统计",
        staffHotel,
        `同一快照 ${snapshot.at}；${snapshot.start} 至 ${snapshot.end}；${snapshot.rows.length} 行，无联系信息`,
      );
  };
  if (!loaded && !error) return <Spinner label="正在生成统计快照" />;
  const metrics = [
    ["总量", snapshot.total],
    ["预占", snapshot.held],
    ["承诺", snapshot.committed],
    ["在住占用", snapshot.staying],
    ["已消费", snapshot.consumed],
    ["剩余量", snapshot.remaining],
    ["可预订量", snapshot.available],
  ] as const;
  const pages = Math.max(1, Math.ceil(snapshot.rows.length / 8));
  return (
    <>
      <Heading
        eyebrow={`${hotelName} · 酒店工作台`}
        title="统计与导出"
        action={
          <Button
            icon={<ArrowDownload20Regular />}
            onClick={exportData}
            disabled={!loaded || busy}
          >
            导出这份快照 CSV
          </Button>
        }
      >
        按住宿日查看房量与订单约定金额，可追溯到每笔订单的逐晚明细。
      </Heading>
      <div className="filter-bar">
        <Field label="住宿日起">
          <FluentDatePicker
            value={start}
            rangeStart={isValidIsoDate(start) ? start : undefined}
            rangeEnd={isValidIsoDate(end) ? end : undefined}
            onValidityChange={(msg) => {
              statsDateErrors.current.start = msg;
            }}
            onChange={(next) => {
              setStart(next);
              if (
                isValidIsoDate(next) &&
                (!isValidIsoDate(end) || end <= next || days(next, end).length > 90)
              ) {
                setEnd(addDays(next, 7));
              }
            }}
          />
        </Field>
        <Field label="住宿日止（不含）">
          <FluentDatePicker
            value={end}
            minDate={isValidIsoDate(start) ? addDays(start, 1) : undefined}
            maxDate={isValidIsoDate(start) ? addDays(start, 90) : undefined}
            rangeStart={isValidIsoDate(start) ? start : undefined}
            rangeEnd={isValidIsoDate(end) ? end : undefined}
            onValidityChange={(msg) => {
              statsDateErrors.current.end = msg;
            }}
            onChange={setEnd}
          />
        </Field>
        <Field label="房型">
          <Select value={room} onChange={(_, d) => setRoom(d.value)}>
            <option value="all">全部房型</option>
            {hotelRooms(data, staffHotel).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button appearance="primary" onClick={refresh}>
          生成统计快照
        </Button>
      </div>
      {error && <Notice intent="error">{error}</Notice>}
      <p className="muted">
        当前快照：{snapshot.at} · {shortDate(snapshot.start)} —{" "}
        {shortDate(snapshot.end)}（不含） ·{" "}
        {snapshot.room === "all"
          ? "全部房型"
          : hotelRooms(data, staffHotel).find((r) => r.id === snapshot.room)
              ?.name}
      </p>
      <section className="summary-band" aria-label="房量与有效金额汇总">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <Text className="muted" size={200}>
              {label} / 间夜
            </Text>
            <Text size={700} weight="semibold" className="summary-number">
              {value}
            </Text>
          </div>
        ))}
        <div className="summary-amount">
          <Text className="muted" size={200}>
            有效间夜约定金额
          </Text>
          <span className="summary-number">
            <Price value={snapshot.amount} size="large" />
          </span>
        </div>
      </section>
      <Notice>
        金额仅包含承诺、在住占用和已消费的间夜；预占与已释放不计入。此处金额不表示实收。停售日可订为零，原有占用及剩余量仍保留。
      </Notice>
      <section className="space-top">
        <div className="section-label">
          <Text as="h2" size={500} weight="semibold">
            关联订单 · 逐晚明细
          </Text>
          <Text className="muted" size={200}>
            {snapshot.rows.length} 条
          </Text>
        </div>
        {snapshot.rows.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>订单编号</th>
                    <th>住宿日</th>
                    <th>房型 / 间数</th>
                    <th>订单状态</th>
                    <th>逐晚状态</th>
                    <th className="numeric">单间价</th>
                    <th className="numeric">有效金额</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.rows
                    .slice(page * 8, page * 8 + 8)
                    .map((row, index) => (
                      <tr key={`${row.order}-${row.date}-${index}`}>
                        <td data-label="订单编号">{row.order}</td>
                        <td data-label="住宿日">{shortDate(row.date)}</td>
                        <td data-label="房型 / 间数">
                          {
                            hotelRooms(data, staffHotel).find(
                              (r) => r.id === row.room,
                            )?.name
                          }{" "}
                          / {row.rooms}
                        </td>
                        <td data-label="订单状态">{row.status}</td>
                        <td data-label="逐晚状态">{row.state}</td>
                        <td data-label="单间价" className="numeric">
                          {money(row.price)}
                        </td>
                        <td data-label="有效金额" className="numeric">
                          {money(row.effective)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="button-row space-top">
              <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
                上一页
              </Button>
              <Text>
                第 {page + 1} / {pages} 页
              </Text>
              <Button
                disabled={page + 1 >= pages}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          </>
        ) : (
          <Empty title="这段日期暂无订单明细">
            空结果仍可导出包含字段表头的 CSV。
          </Empty>
        )}
      </section>
    </>
  );
}

function IncidentItem({
  incident,
  item,
  onView,
}: {
  incident: Incident;
  item: Incident["items"][number];
  onView: (id: string) => void;
}) {
  const { data, update, audit, connected, command } = useApp();
  const order = data.orders.find((o) => o.id === item.order)!;
  const [notes, setNotes] = useState(""),
    [contacted, setContacted] = useState(false),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!order) return <Notice>关联订单 {item.order}，请从订单详情查阅。</Notice>;
  const save = async (complete: boolean) => {
    if (busy) return;
    if (!notes.trim()) {
      setError("请填写联系或处理说明。");
      return;
    }
    if (complete && order.status === "已确认" && !contacted) {
      setError(
        "已确认订单需先取得联系并登记事实；未联系上时保留原状态与占用。",
      );
      return;
    }
    if (connected) {
      setBusy(true);
      try {
        await command({
          action: "incident_update",
          id: incident.id,
          incident: { id: item.order },
          note: notes,
          mode: complete ? (contacted ? "reached" : "complete") : "contacting",
        });
        setError("");
        setNotes("");
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
      return;
    }
    const status: OrderStatus = !complete
      ? order.status
      : order.status === "待确认"
        ? order.deadline <= Date.now()
          ? "已超时"
          : "已拒绝"
        : order.status === "已确认"
          ? "已取消"
          : order.status;
    update((current) => ({
      ...current,
      incidents: current.incidents.map((i) =>
        i.id === incident.id
          ? {
              ...i,
              items: i.items.map((entry) =>
                entry.order === item.order
                  ? {
                      ...entry,
                      progress: complete ? "已处理" : "联系中",
                      notes: notes.trim(),
                      contactAt: dateTime(),
                    }
                  : entry,
              ),
            }
          : i,
      ),
      orders: current.orders.map((o) =>
        o.id === order.id && status !== o.status
          ? {
              ...o,
              status,
              ...(["已退房", "已拒绝", "已取消", "已超时"].includes(status)
                ? { terminalAt: Date.now() }
                : {}),
              history: [
                ...o.history,
                {
                  time: dateTime(),
                  text: `酒店原因${status === "已取消" ? "取消" : status === "已超时" ? "关联已超时记录" : "拒绝"}；关联异常 ${incident.id}`,
                },
              ],
            }
          : o,
      ),
    }));
    audit(
      "处置异常订单",
      order.id,
      `${incident.id}；${complete ? "已处理" : "联系中"}；${status === order.status ? "保留原订单状态" : `按酒店原因转${status}`}`,
    );
    setError("");
    setNotes("");
  };
  return (
    <article className="incident-contact">
      <div className="section-label">
        <div className="inline">
          <Text weight="semibold">{order.id}</Text>
          <Status status={order.status} />
        </div>
        <Badge
          appearance="tint"
          color={item.progress === "已处理" ? "success" : "warning"}
        >
          {item.progress}
        </Badge>
      </div>
      <p className="muted">
        {shortDate(order.start)} — {shortDate(order.end)} ·{" "}
        {hotelRoom(data, order.hotel, order.room)?.name} · {order.rooms} 间
      </p>
      <ol className="timeline space-top">
        <li>
          <time>
            {item.contactAt ? formatDisplayTime(item.contactAt) : "待登记联系记录"}
          </time>
          {item.notes || "尚未开始处置。"}
        </li>
      </ol>
      <Button
        appearance="subtle"
        className="space-top"
        onClick={() => onView(order.id)}
      >
        查看关联订单与联系方式
      </Button>
      {item.progress !== "已处理" && !incident.closed && (
        <div className="stack space-top">
          <Field label="联系 / 处理说明" required>
            <Textarea
              value={notes}
              onChange={(_, d) => setNotes(d.value)}
              placeholder="如实登记联系结果与线下处置情况"
            />
          </Field>
          {order.status === "已确认" && (
            <Checkbox
              checked={contacted}
              onChange={(_, d) => setContacted(Boolean(d.checked))}
              label="已联系到顾客，联系记录齐备"
            />
          )}
          <div className="button-row">
            <Button onClick={() => save(false)}>保存联系进度</Button>
            <Button appearance="primary" onClick={() => save(true)}>
              {order.status === "待确认"
                ? "按酒店原因拒绝"
                : order.status === "已确认"
                  ? "按酒店原因取消"
                  : order.status === "已入住"
                    ? "记录线下安置结果"
                    : "关联记录，保留终态"}
            </Button>
          </div>
          {order.status === "已入住" && (
            <p className="muted">保留在住状态与占用，实际退房后再据实结转。</p>
          )}
          {error && <Notice intent="error">{error}</Notice>}
        </div>
      )}
    </article>
  );
}

export function IncidentsPage() {
  const { data, update, audit, notify, role, staffHotel, connected, command } =
    useApp();
  const hotelName =
    data.hotels.find((h) => h.id === staffHotel)?.name || "酒店";
  const [selected, setSelected] = useState(data.incidents[0]?.id || ""),
    [create, setCreate] = useState(false),
    [viewOrder, setViewOrder] = useState("");
  const [title, setTitle] = useState(""),
    [reason, setReason] = useState(""),
    [hotel, setHotel] = useState(
      role === "staff" ? staffHotel : data.hotels[0]?.id || "",
    ),
    [room, setRoom] = useState(connected ? "" : "garden"),
    [start, setStart] = useState(initialConditions.start),
    [end, setEnd] = useState(initialConditions.end),
    [error, setError] = useState("");
  const incidentDateErrors = useRef({ start: "", end: "" });
  const incidents = data.incidents.filter(
      (i) => role === "admin" || i.hotel === staffHotel,
    ),
    incident = incidents.find((i) => i.id === selected) || incidents[0];
  const current = data.orders.find(
    (o) => o.id === viewOrder && (role === "admin" || o.hotel === staffHotel),
  );
  const affected = data.orders.filter(
    (o) =>
      o.hotel === hotel &&
      (!room || o.room === room) &&
      o.start < end &&
      o.end > start &&
      activeStatuses.includes(o.status),
  );
  const createIncident = async () => {
    if (incidentDateErrors.current.start || incidentDateErrors.current.end) {
      setError(
        incidentDateErrors.current.start || incidentDateErrors.current.end,
      );
      return;
    }
    if (
      !title.trim() ||
      !reason.trim() ||
      !isValidIsoDate(start) ||
      !isValidIsoDate(end) ||
      end <= start ||
      days(start, end).length > 90
    ) {
      setError("请填写异常标题、原因和有效日期范围（最多 90 个住宿日）。");
      return;
    }
    if (connected) {
      try {
        const { id } = await command({
          action: "incident_open",
          hotel,
          incident: { room, title, reason, start, end },
        });
        setCreate(false);
        setSelected(id || "");
        notify("影响范围已先停售，请继续逐单登记联系与处置结果。");
      } catch (cause) {
        setError(errorMessage(cause));
      }
      return;
    }
    if (
      affected.some(
        (o) =>
          o.incident &&
          !data.incidents.find((i) => i.id === o.incident)?.closed,
      )
    ) {
      setError(
        "影响清单中已有未完成异常的订单，请先查看原事件，避免重复处置。",
      );
      return;
    }
    const id = `EV${String(Date.now()).slice(-8)}`;
    const event: Incident = {
      id,
      hotel,
      room,
      title: title.trim(),
      reason: reason.trim(),
      start,
      end,
      closed: false,
      items: affected.map((o) => ({
        order: o.id,
        progress: "未处理",
        notes: "",
      })),
    };
    update((current) => {
      const calendar = { ...current.calendar };
      for (const date of days(start, end)) {
        const entry = calendarEntry(current, hotel, room, date);
        calendar[entryKey(hotel, room, date)] = {
          ...entry,
          stopped: true,
          version: entry.version + 1,
        };
      }
      return {
        ...current,
        calendar,
        incidents: [event, ...current.incidents],
        orders: current.orders.map((o) =>
          affected.some((a) => a.id === o.id) ? { ...o, incident: id } : o,
        ),
      };
    });
    audit(
      "登记异常并停售",
      id,
      `${hotel}/${room}；${start} 至 ${end}；关联 ${affected.length} 笔订单`,
    );
    setCreate(false);
    setSelected(id);
    notify("影响范围已先停售，请继续逐单登记联系与处置结果。");
  };
  return (
    <>
      <Heading
        eyebrow={role === "staff" ? `${hotelName} · 酒店工作台` : "平台管理台"}
        title={role === "staff" ? "异常处置" : "异常事件管理"}
        action={
          <Button
            appearance="primary"
            icon={<Add20Regular />}
            onClick={() => {
              const targetHotel =
                role === "staff"
                  ? staffHotel
                  : hotel || data.hotels[0]?.id || "";
              const targetRooms = hotelRooms(data, targetHotel);
              incidentDateErrors.current = { start: "", end: "" };
              setTitle("");
              setReason("");
              setHotel(targetHotel);
              setRoom(connected ? "" : targetRooms[0]?.id || "garden");
              setStart(initialConditions.start);
              setEnd(initialConditions.end);
              setError("");
              setCreate(true);
            }}
          >
            登记异常
          </Button>
        }
      >
        先阻止新的受影响预订，再按每一笔订单的实际状态处置。
      </Heading>
      {incidents.length ? (
        <div className="incident-layout">
          <nav className="incident-list" aria-label="异常事件列表">
            {incidents.map((i) => (
              <Button
                key={i.id}
                appearance="outline"
                className={`incident-button ${incident?.id === i.id ? "selected" : ""}`}
                onClick={() => setSelected(i.id)}
              >
                <Badge
                  appearance="tint"
                  color={i.closed ? "success" : "warning"}
                >
                  {i.closed ? "已完成" : "处理中"}
                </Badge>
                <Text size={500} weight="semibold">
                  {i.title}
                </Text>
                <span className="muted">
                  {data.hotels.find((h) => h.id === i.hotel)?.name}
                </span>
                <span className="muted">
                  {shortDate(i.start)} — {shortDate(i.end)}
                </span>
                <span className="order-number">
                  {i.id} ·{" "}
                  {i.items.filter((item) => item.progress === "已处理").length}{" "}
                  / {i.items.length} 笔已处理
                </span>
              </Button>
            ))}
          </nav>
          {incident && (
            <section className="incident-detail">
              <div className="section-label">
                <Text as="h2" size={600} weight="semibold">
                  {incident.title}
                </Text>
                <Badge appearance="tint" color="warning">
                  影响范围已停售
                </Badge>
              </div>
              <p className="muted">{incident.reason}</p>
              <div className="facts">
                <div className="fact">
                  <span className="fact-label">酒店 / 房型</span>
                  <div className="fact-value">
                    {data.hotels.find((h) => h.id === incident.hotel)?.name} ·{" "}
                    {incident.room
                      ? hotelRoom(data, incident.hotel, incident.room)?.name
                      : "全部房型"}
                  </div>
                </div>
                <div className="fact">
                  <span className="fact-label">影响住宿日</span>
                  <div className="fact-value">
                    {shortDate(incident.start)} — {shortDate(incident.end)}
                    （不含）
                  </div>
                </div>
              </div>
              <Notice>
                联系中属于处置进度，原订单状态与占用继续保留。已确认订单须联系记录齐备后按酒店原因取消；已入住订单记录线下安置。
              </Notice>
              {incident.items.length ? (
                incident.items.map((item) => (
                  <IncidentItem
                    key={`${incident.id}-${item.order}`}
                    incident={incident}
                    item={item}
                    onView={setViewOrder}
                  />
                ))
              ) : (
                <p className="muted space-top">
                  影响范围内暂无有效订单。停售记录已保留。
                </p>
              )}
              <Button
                className="space-top"
                disabled={
                  incident.closed ||
                  incident.items.some((i) => i.progress !== "已处理")
                }
                onClick={async () => {
                  if (connected) {
                    try {
                      await command({
                        action: "incident_close",
                        id: incident.id,
                      });
                      notify("事件已完成。恢复销售前请在日历核对房量和停售。");
                    } catch (cause) {
                      notify(errorMessage(cause), "error");
                    }
                    return;
                  }
                  update((current) => ({
                    ...current,
                    incidents: current.incidents.map((i) =>
                      i.id === incident.id ? { ...i, closed: true } : i,
                    ),
                  }));
                  audit(
                    "完成异常事件",
                    incident.id,
                    "全部关联订单已登记处置结果；停售标记保留",
                  );
                  notify(
                    "事件已完成。恢复销售前请核对营业与房量条件，并在日历中调整停售。",
                  );
                }}
              >
                {incident.closed ? "事件已完成" : "全部处理后完成事件"}
              </Button>
            </section>
          )}
        </div>
      ) : (
        <Empty title="当前没有异常事件">
          发现真实无法履约的情况时，登记影响范围并逐单跟进。
        </Empty>
      )}
      <ConfirmDialog
        open={create}
        title="登记异常并停售影响范围"
        confirm="登记并先停售"
        onClose={() => setCreate(false)}
        onConfirm={createIncident}
      >
        <div className="form-grid">
          <Field label="异常标题" className="span-2">
            <Input value={title} onChange={(_, d) => setTitle(d.value)} />
          </Field>
          <Field label="异常原因" className="span-2">
            <Textarea value={reason} onChange={(_, d) => setReason(d.value)} />
          </Field>
          {role === "admin" && (
            <Field label="酒店" className="span-2">
              <Select
                value={hotel}
                onChange={(_, d) => {
                  setHotel(d.value);
                  setRoom(connected ? "" : "garden");
                }}
              >
                {data.hotels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="影响房型" className="span-2">
            <Select value={room} onChange={(_, d) => setRoom(d.value)}>
              {connected && <option value="">全部房型</option>}
              {hotelRooms(data, hotel).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="影响住宿日起">
            <FluentDatePicker
              value={start}
              rangeStart={isValidIsoDate(start) ? start : undefined}
              rangeEnd={isValidIsoDate(end) ? end : undefined}
              onValidityChange={(msg) => {
                incidentDateErrors.current.start = msg;
              }}
              onChange={(nextStart) => {
                setStart(nextStart);
                if (
                  isValidIsoDate(nextStart) &&
                  (!isValidIsoDate(end) ||
                    end <= nextStart ||
                    days(nextStart, end).length > 90)
                ) {
                  setEnd(addDays(nextStart, 2));
                }
              }}
            />
          </Field>
          <Field label="影响住宿日止（不含）">
            <FluentDatePicker
              value={end}
              minDate={isValidIsoDate(start) ? addDays(start, 1) : undefined}
              maxDate={isValidIsoDate(start) ? addDays(start, 90) : undefined}
              rangeStart={isValidIsoDate(start) ? start : undefined}
              rangeEnd={isValidIsoDate(end) ? end : undefined}
              onValidityChange={(msg) => {
                incidentDateErrors.current.end = msg;
              }}
              onChange={setEnd}
            />
          </Field>
        </div>
        <p className="muted space-top">
          当前影响 {affected.length}{" "}
          笔有效订单。登记后先停售，尚未处理的旧订单保留原状态。
        </p>
        {error && <Notice intent="error">{error}</Notice>}
      </ConfirmDialog>
      <OrderDrawer
        order={current}
        onClose={() => setViewOrder("")}
        incidentId={incident?.id}
        readOnly
      />
    </>
  );
}

export function AuditPage() {
  const { data, role, staffHotel, connected } = useApp();
  const hotelName =
    data.hotels.find((h) => h.id === staffHotel)?.name || "酒店";
  const [object, setObject] = useState(""),
    [action, setAction] = useState("all"),
    [actor, setActor] = useState("all");
  const ownObject = (id: string) =>
    id === staffHotel ||
    id.startsWith(`${staffHotel}/`) ||
    data.orders.some((o) => o.id === id && o.hotel === staffHotel) ||
    data.incidents.some((i) => i.id === id && i.hotel === staffHotel);
  const logs = data.audit.filter(
    (log) =>
      (connected || role === "admin" || ownObject(log.object)) &&
      log.object.toLowerCase().includes(object.toLowerCase()) &&
      (action === "all" || log.action === action) &&
      (actor === "all" || log.role === actor),
  );
  const hasAuditFilters = object !== "" || action !== "all" || actor !== "all";
  return (
    <>
      <Heading
        eyebrow={role === "staff" ? `${hotelName} · 酒店工作台` : "平台管理台"}
        title={role === "staff" ? "操作日志" : "平台审计记录"}
      >
        按对象、动作和操作者查阅追加记录；日志不提供修改入口，不展示完整联系方式。
      </Heading>
      <div className="filter-bar">
        <Field label="对象编号">
          <Input
            value={object}
            onChange={(_, d) => setObject(d.value)}
            placeholder="订单、事件或酒店编号"
          />
        </Field>
        <Field label="动作">
          <Select value={action} onChange={(_, d) => setAction(d.value)}>
            <option value="all">全部动作</option>
            {[...new Set(data.audit.map((l) => l.action))].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="操作者">
          <Select value={actor} onChange={(_, d) => setActor(d.value)}>
            <option value="all">全部操作者</option>
            <option>顾客</option>
            <option>酒店工作人员</option>
            <option>平台管理员</option>
            <option>系统</option>
          </Select>
        </Field>
        {hasAuditFilters && (
          <Button
            appearance="subtle"
            onClick={() => {
              setObject("");
              setAction("all");
              setActor("all");
            }}
          >
            重置筛选
          </Button>
        )}
      </div>
      {logs.length ? (
        <section aria-label="审计记录">
          {logs.map((log) => (
            <article className="audit-entry" key={log.id}>
              <time className="muted">{formatDisplayTime(log.at)}</time>
              <div>
                <Text weight="semibold">{log.action}</Text>
                <p>{log.detail}</p>
                <Text size={200} className="muted">
                  {log.object} · {log.role} · {log.id}
                </Text>
              </div>
              <Badge
                appearance="tint"
                color={log.result === "成功" ? "success" : "warning"}
              >
                {log.result}
              </Badge>
            </article>
          ))}
        </section>
      ) : (
        <Empty title="没有匹配的操作记录">
          请调整对象编号、动作或操作者条件。
        </Empty>
      )}
    </>
  );
}

export function AdminHotels() {
  const { data, update, audit, notify, connected, command } = useApp();
  const [toggle, setToggle] = useState<Hotel | null>(null),
    [create, setCreate] = useState(false),
    [draft, setDraft] = useState({
      name: "",
      city: "",
      address: "",
      phone: "",
    }),
    [error, setError] = useState("");
  const save = async () => {
    if (!Object.values(draft).every((v) => v.trim())) {
      setError("请填写酒店名称、城市、地址和联系电话。");
      return;
    }
    if (connected) {
      try {
        await command({ action: "hotel", property: draft });
        setCreate(false);
        setDraft({ name: "", city: "", address: "", phone: "" });
        notify("酒店已创建，可为工作人员绑定所属酒店。");
      } catch (cause) {
        setError(errorMessage(cause));
      }
      return;
    }
    const id = `HT${String(Date.now()).slice(-6)}`;
    update((current) => ({
      ...current,
      hotels: [
        ...current.hotels,
        {
          ...draft,
          id,
          district: draft.city,
          image: "/images/garden-entrance.png",
          caption: "新的住宿，等待被发现。",
          description: "酒店资料由所属工作人员继续维护。",
          offset: 0,
          enabled: true,
        },
      ],
    }));
    audit("创建酒店", id, "创建酒店资料并启用");
    setCreate(false);
    setDraft({ name: "", city: "", address: "", phone: "" });
    notify("酒店已创建，可为工作人员绑定所属酒店。");
  };
  return (
    <>
      <Heading
        eyebrow="平台管理台"
        title="酒店管理"
        action={
          <Button
            appearance="primary"
            icon={<Add20Regular />}
            onClick={() => {
              setCreate(true);
              setError("");
            }}
          >
            创建酒店
          </Button>
        }
      >
        管理酒店启停。已有订单与历史资料保留，实际无法履约的情况从异常事件处理。
      </Heading>
      {data.hotels.map((h) => (
        <article className="hotel-admin-card" key={h.id}>
          <img src={h.image} alt={`${h.name}演示图片`} />
          <div>
            <div className="order-title">
              <Text as="h2" size={600} weight="semibold">
                {h.name}
              </Text>
              <Badge appearance="tint" color={h.enabled ? "success" : "subtle"}>
                {h.enabled ? "启用" : "停用"}
              </Badge>
            </div>
            <p className="muted">
              {h.city} · {h.address}
            </p>
            <p className="muted">
              {h.phone} · 酒店编号 {h.id}
            </p>
          </div>
          <div className="button-row">
            <Button onClick={() => setToggle(h)}>
              {h.enabled ? "停用酒店" : "启用酒店"}
            </Button>
          </div>
        </article>
      ))}
      <ConfirmDialog
        danger={Boolean(toggle?.enabled)}
        open={Boolean(toggle)}
        title={toggle?.enabled ? "停用这家酒店？" : "启用这家酒店？"}
        confirm={toggle?.enabled ? "确认停用" : "确认启用"}
        onClose={() => setToggle(null)}
        onConfirm={async () => {
          if (!toggle) return;
          if (connected) {
            try {
              await command({
                action: "hotel_enabled",
                hotel: toggle.id,
                enabled: !toggle.enabled,
              });
              setToggle(null);
              notify("酒店状态已更新。");
            } catch (cause) {
              notify(errorMessage(cause), "error");
            }
            return;
          }
          update((current) => ({
            ...current,
            hotels: current.hotels.map((h) =>
              h.id === toggle.id ? { ...h, enabled: !h.enabled } : h,
            ),
          }));
          audit(
            toggle.enabled ? "停用酒店" : "启用酒店",
            toggle.id,
            "变更可售状态；历史订单保留",
          );
          setToggle(null);
          notify("酒店状态已更新。");
        }}
      >
        <p>
          {toggle?.name}
          。停用后停止新增预订，已有订单与历史资料保留；如真实不能履约，请另行登记异常。
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={create}
        title="创建酒店"
        confirm="创建酒店"
        onClose={() => setCreate(false)}
        onConfirm={save}
      >
        <div className="form-grid">
          {(["name", "city", "address", "phone"] as const).map((key, i) => (
            <Field
              key={key}
              label={["酒店名称", "城市", "地址", "联系电话"][i]}
              className={key === "address" ? "span-2" : ""}
            >
              <Input
                value={draft[key]}
                onChange={(_, d) => setDraft({ ...draft, [key]: d.value })}
              />
            </Field>
          ))}
        </div>
        {error && (
          <div className="space-top">
            <Notice intent="error">{error}</Notice>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

export function AdminAccounts() {
  const { data, update, audit, notify, connected, command } = useApp();
  const [create, setCreate] = useState(false),
    [name, setName] = useState(""),
    [hotel, setHotel] = useState(connected ? data.hotels[0]?.id || "" : "qt"),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [toggle, setToggle] = useState("");
  const toggleAccount = data.accounts.find((a) => a.id === toggle);
  return (
    <>
      <Heading
        eyebrow="平台管理台"
        title="账户与权限"
        action={
          <Button
            appearance="primary"
            icon={<Add20Regular />}
            onClick={() => {
              setName("");
              setUsername("");
              setPassword("");
              setHotel(hotel || data.hotels[0]?.id || "qt");
              setError("");
              setCreate(true);
            }}
          >
            创建工作人员账户
          </Button>
        }
      >
        每位工作人员绑定唯一所属酒店；顾客注册不提供工作人员或管理员角色。
      </Heading>
      <Notice>
        首次管理员由部署初始化。角色分配与账户停用均留有审计记录；被停用的账户不能继续执行受保护操作。
      </Notice>
      <div
        className="table-wrap space-top"
        role="list"
        aria-label="管理账户列表"
      >
        {data.accounts.map((account) => (
          <article
            className="account-row"
            role="listitem"
            key={account.username || account.id}
          >
            <div>
              <Text weight="semibold" size={400}>
                {account.label}
              </Text>
              <Text className="muted" size={200}>
                {account.username || account.id}
              </Text>
            </div>
            <div>
              <Text>
                {account.role === "admin"
                  ? "平台管理员"
                  : account.role === "staff"
                    ? "酒店工作人员"
                    : account.role}
              </Text>
              <Badge
                appearance="tint"
                color={account.enabled ? "success" : "subtle"}
              >
                {account.enabled ? "启用" : "停用"}
              </Badge>
            </div>
            <div>
              <Text className="muted" size={200}>
                所属范围
              </Text>
              <Text>
                {account.hotel
                  ? data.hotels.find((h) => h.id === account.hotel)?.name
                  : "平台管理职责"}
              </Text>
            </div>
            <Button
              disabled={account.role === "admin" || account.id === "AD001"}
              onClick={() => setToggle(account.id)}
            >
              {account.role === "admin" || account.id === "AD001"
                ? "当前管理员"
                : account.enabled
                  ? "停用账户"
                  : "启用账户"}
            </Button>
          </article>
        ))}
      </div>
      <ConfirmDialog
        open={create}
        title="创建工作人员账户"
        confirm="创建并绑定酒店"
        onClose={() => setCreate(false)}
        onConfirm={async () => {
          if (!name.trim() || !hotel) {
            setError("请填写账户名称并选择唯一所属酒店。");
            return;
          }
          if (connected) {
            try {
              await command({
                action: "staff_create",
                user: { username, password, label: name, hotel },
              });
              setCreate(false);
              setUsername("");
              setPassword("");
              setName("");
              notify("工作人员账户与酒店归属已建立。");
            } catch (cause) {
              setError(errorMessage(cause));
            }
            return;
          }
          const id = `ST${String(Date.now()).slice(-6)}`;
          update((current) => ({
            ...current,
            accounts: [
              ...current.accounts,
              {
                id,
                label: name.trim(),
                role: "酒店工作人员",
                hotel,
                enabled: true,
              },
            ],
          }));
          audit(
            "创建工作人员并分配角色",
            id,
            `酒店工作人员；唯一酒店范围 ${hotel}`,
          );
          setCreate(false);
          setName("");
          notify("工作人员账户与酒店归属已建立。");
        }}
      >
        <div className="stack">
          <Field label="账户显示名称" required>
            <Input value={name} onChange={(_, d) => setName(d.value)} />
          </Field>
          {connected && (
            <>
              <Field label="登录账户名" required>
                <Input
                  value={username}
                  autoComplete="off"
                  onChange={(_, d) => setUsername(d.value)}
                />
              </Field>
              <Field label="初始密码" required>
                <Input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(_, d) => setPassword(d.value)}
                />
              </Field>
            </>
          )}
          <Field label="角色">
            <Text>酒店工作人员</Text>
          </Field>
          <Field label="唯一所属酒店" required>
            <Select value={hotel} onChange={(_, d) => setHotel(d.value)}>
              {data.hotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          {error && <Notice intent="error">{error}</Notice>}
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        danger={Boolean(toggleAccount?.enabled)}
        open={Boolean(toggle)}
        title="更新账户状态"
        confirm="确认更新"
        onClose={() => setToggle("")}
        onConfirm={async () => {
          const account = data.accounts.find((a) => a.id === toggle);
          if (!account) return;
          if (connected) {
            try {
              await command({
                action: "staff_enabled",
                id: account.id,
                enabled: !account.enabled,
              });
              setToggle("");
              notify("账户状态已更新。");
            } catch (cause) {
              notify(errorMessage(cause), "error");
            }
            return;
          }
          update((current) => ({
            ...current,
            accounts: current.accounts.map((a) =>
              a.id === toggle ? { ...a, enabled: !a.enabled } : a,
            ),
          }));
          audit(
            account.enabled ? "停用账户" : "启用账户",
            toggle,
            "更新受保护操作的访问资格",
          );
          setToggle("");
          notify("账户状态已更新。");
        }}
      >
        <p>停用后，账户既有会话不能继续执行受保护操作；其历史业务记录保留。</p>
      </ConfirmDialog>
    </>
  );
}
