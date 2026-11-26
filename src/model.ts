export type Role = "customer" | "staff" | "admin";
export type OrderStatus =
  "待确认" | "已确认" | "已入住" | "已退房" | "已取消" | "已拒绝" | "已超时";
export type Scenario = "normal" | "price" | "unavailable" | "uncertain";
export type Night = { date: string; price: number };
export type Conditions = {
  city: string;
  start: string;
  end: string;
  people: number;
  rooms: number;
  type: string;
  min: string;
  max: string;
};
export type HotelPhoto = {
  id: string;
  url: string;
  caption: string;
};
export type Hotel = {
  id: string;
  name: string;
  city: string;
  address: string;
  district: string;
  image: string;
  caption: string;
  description: string;
  offset: number;
  enabled: boolean;
  phone: string;
  photos?: HotelPhoto[];
};
export type Room = {
  hotel?: string;
  id: string;
  name: string;
  price: number;
  capacity: number;
  size: number;
  bed: string;
  description: string;
  enabled: boolean;
};
export type Order = {
  id: string;
  hotel: string;
  room: string;
  start: string;
  end: string;
  people: number;
  rooms: number;
  name: string;
  phone: string;
  status: OrderStatus;
  nights: Night[];
  created: number;
  deadline: number;
  version: number;
  owner: string;
  history: { time: string; text: string }[];
  checkout?: string;
  terminalAt?: number;
  phoneTail?: string;
  incident?: string;
  occupancy?: Record<string, string>;
};
export type CalendarEntry = {
  total: number;
  price: number;
  stopped: boolean;
  version: number;
  occupied?: number;
};
export type Incident = {
  id: string;
  hotel: string;
  title: string;
  reason: string;
  start: string;
  end: string;
  room: string;
  closed: boolean;
  items: {
    order: string;
    progress: "未处理" | "联系中" | "已处理";
    notes: string;
    contactAt?: string;
  }[];
};
export type Audit = {
  id: string;
  at: string;
  role: string;
  action: string;
  object: string;
  detail: string;
  result: string;
};
export type Account = {
  id: string;
  username?: string;
  label: string;
  role: string;
  hotel: string;
  enabled: boolean;
};
export type DemoData = {
  connected?: boolean;
  hotels: Hotel[];
  rooms: Room[];
  roomDetails?: Record<string, Partial<Room>>;
  orders: Order[];
  calendar: Record<string, CalendarEntry>;
  incidents: Incident[];
  audit: Audit[];
  accounts: Account[];
};

export const STORAGE = "hotel-ui-demo-v1";
export const SESSION = "hotel-ui-session-v1";
export const SCENARIO = "hotel-ui-scenario-v1";
export const TODAY = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}
export function normalizeDigits(input: string) {
  return input
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[。．]/g, ".");
}
export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
export function formatIsoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    return null;
  return { year: y, month: m, day: d };
}
export function isValidIsoDate(value: string) {
  return parseIsoDate(value) !== null;
}
export function addDays(date: string, n: number) {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  const dt = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + n),
  );
  return formatIsoDate(
    dt.getUTCFullYear(),
    dt.getUTCMonth() + 1,
    dt.getUTCDate(),
  );
}
export function days(start: string, end: string) {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  if (!s || !e) return [];
  const count = Math.round(
    (Date.UTC(e.year, e.month - 1, e.day) -
      Date.UTC(s.year, s.month - 1, s.day)) /
      86400000,
  );
  return Array.from(
    { length: Number.isFinite(count) ? Math.max(0, Math.min(count, 366)) : 0 },
    (_, i) => addDays(start, i),
  );
}
export function shortDate(date: string) {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  return `${parsed.month}月${parsed.day}日`;
}
export function weekday(date: string) {
  const parsed = parseIsoDate(date);
  if (!parsed) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00+08:00`));
}
export function dateTime(value = Date.now()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
export function formatDisplayTime(value: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const normalized = value
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T")
    .replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return value;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}
export function money(cents: number) {
  return `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
export function total(nights: Night[], rooms = 1) {
  return nights.reduce((sum, night) => sum + night.price * rooms, 0);
}
export const initialConditions: Conditions = {
  city: "南京",
  start: addDays(TODAY, 7),
  end: addDays(TODAY, 9),
  people: 2,
  rooms: 1,
  type: "all",
  min: "",
  max: "",
};
export const activeStatuses: OrderStatus[] = ["待确认", "已确认", "已入住"];
export const statuses: OrderStatus[] = [
  "待确认",
  "已确认",
  "已入住",
  "已退房",
  "已取消",
  "已拒绝",
  "已超时",
];

const hotels: Hotel[] = [
  {
    id: "qt",
    name: "秦淮 · 栖庭",
    city: "南京",
    address: "南京市秦淮区庭院路 18 号（演示地址）",
    district: "秦淮区",
    image: "/images/courtyard-room.png",
    caption: "把庭院，留在窗边。",
    description:
      "木色、晨光与一方安静的庭院。在城市的日常里，找到一处可以慢下来的房间。",
    offset: 0,
    enabled: true,
    phone: "025-00000001",
    photos: [
      {
        id: "seed-qt-cover",
        url: "/images/courtyard-room.png",
        caption: "庭院大床房 · 晨光木韵",
      },
      {
        id: "seed-qt-entrance",
        url: "/images/garden-entrance.png",
        caption: "中式庭院入口 · 灰砖绿植",
      },
    ],
  },
  {
    id: "xw",
    name: "玄武 · 湖畔",
    city: "南京",
    address: "南京市玄武区湖景路 26 号（演示地址）",
    district: "玄武区",
    image: "/images/lake-room.png",
    caption: "醒来，正好看见湖。",
    description:
      "清晨的湖光、宽敞的窗台和一杯热茶。让一次短暂的停留，也拥有舒展的节奏。",
    offset: 6000,
    enabled: true,
    phone: "025-00000002",
    photos: [
      {
        id: "seed-xw-cover",
        url: "/images/lake-room.png",
        caption: "湖景客房 · 宽窗茶席",
      },
    ],
  },
  {
    id: "ys",
    name: "阅江 · 泊舍",
    city: "南京",
    address: "南京市鼓楼区泊园路 9 号（演示地址）",
    district: "鼓楼区",
    image: "/images/garden-entrance.png",
    caption: "入一扇门，换一种步调。",
    description:
      "灰砖与暖木围合的小院，把喧闹留在门外。为旅途中的你，留一盏温暖的灯。",
    offset: -7000,
    enabled: true,
    phone: "025-00000003",
    photos: [
      {
        id: "seed-ys-cover",
        url: "/images/garden-entrance.png",
        caption: "泊舍小院 · 灰砖与暖木",
      },
    ],
  },
];
const rooms: Room[] = [
  {
    id: "garden",
    name: "庭院大床房",
    price: 46800,
    capacity: 2,
    size: 32,
    bed: "1 张 1.8m 大床",
    description: "庭院景观 · 独立卫浴",
    enabled: true,
  },
  {
    id: "window",
    name: "临窗大床房",
    price: 49800,
    capacity: 2,
    size: 36,
    bed: "1 张 1.8m 大床",
    description: "落地窗 · 阅读角",
    enabled: true,
  },
  {
    id: "twin",
    name: "舒适双床房",
    price: 52800,
    capacity: 2,
    size: 38,
    bed: "2 张 1.2m 单人床",
    description: "双床布局 · 独立卫浴",
    enabled: true,
  },
];
function seedOrder(
  id: string,
  status: OrderStatus,
  offset = 7,
  room = "garden",
  owner = "me",
  roomCount = 1,
): Order {
  const start = addDays(TODAY, offset),
    end = addDays(start, 2),
    now = Date.now();
  const created =
    status === "待确认"
      ? now - 180000
      : offset < 0
        ? Date.parse(`${start}T00:00:00+08:00`) - 86400000
        : now - 86400000;
  const price = rooms.find((r) => r.id === room)!.price;
  return {
    id,
    hotel: "qt",
    room,
    start,
    end,
    people: 2,
    rooms: roomCount,
    name: "演示顾客",
    phone: "13800000000",
    status,
    nights: days(start, end).map((date) => ({ date, price })),
    created,
    deadline: created + 900000,
    version: 1,
    owner,
    history: [
      { time: dateTime(created), text: "预订已提交，保存逐晚报价" },
      ...(status === "待确认"
        ? []
        : [
            {
              time: dateTime(created + 600000),
              text:
                status === "已确认" || status === "已入住"
                  ? "酒店已确认预订"
                  : `订单${status}`,
            },
          ]),
    ],
  };
}
export function createInitialData(): DemoData {
  const orders = [
    seedOrder("HB20260001", "已确认", 10),
    seedOrder("HB20260002", "待确认", 8, "window"),
    seedOrder("HB20260003", "已退房", -5),
    seedOrder("HB20260004", "已入住", -1, "twin", "other"),
    seedOrder("HB20260005", "已确认", 0, "garden", "other"),
    seedOrder("HB20260006", "已确认", 8, "twin", "other", 2),
    seedOrder("HB20260007", "已取消", -2),
    seedOrder("HB20260008", "已拒绝", -1),
    seedOrder("HB20260009", "已超时", -1),
  ];
  orders[2].checkout = `${addDays(TODAY, -3)}T11:00:00+08:00`;
  orders.push({
    ...seedOrder("HB20260010", "已确认", 12),
    incident: "EV2026001",
  });
  orders.push({
    ...seedOrder("HB20260011", "已退房", -12),
    terminalAt: Date.now() - 8 * 86400000,
    phoneTail: "0000",
    phone: "",
    name: "",
    checkout: `${addDays(TODAY, -10)}T11:00:00+08:00`,
  });
  return {
    hotels,
    rooms,
    orders,
    calendar: {},
    incidents: [
      {
        id: "EV2026001",
        hotel: "qt",
        title: "庭院区域设备检修",
        reason: "庭院区域供水设备故障，影响指定日期的庭院大床房履约。",
        start: addDays(TODAY, 12),
        end: addDays(TODAY, 14),
        room: "garden",
        closed: false,
        items: [
          {
            order: "HB20260010",
            progress: "联系中",
            notes: "已尝试联系，尚未接通；原订单与房量占用保留。",
            contactAt: dateTime(),
          },
        ],
      },
    ],
    audit: [
      {
        id: "LOG0001",
        at: dateTime(),
        role: "酒店工作人员",
        action: "登记异常并停售",
        object: "EV2026001",
        detail: "庭院区域设备检修；指定日期停止新增预订",
        result: "成功",
      },
      {
        id: "LOG0002",
        at: dateTime(Date.now() - 120000),
        role: "系统",
        action: "创建订单",
        object: "HB20260002",
        detail: "待确认；保存逐晚报价与预占",
        result: "成功",
      },
      {
        id: "LOG0003",
        at: dateTime(Date.now() - 300000),
        role: "酒店工作人员",
        action: "更新日历",
        object: "qt/window",
        detail: "每晚单间价 498 元；版本 1",
        result: "成功",
      },
    ],
    accounts: [
      {
        id: "ST001",
        label: "前台示例账户",
        role: "酒店工作人员",
        hotel: "qt",
        enabled: true,
      },
      {
        id: "AD001",
        label: "管理员示例账户",
        role: "平台管理员",
        hotel: "",
        enabled: true,
      },
    ],
  };
}
export function loadData(): DemoData {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE) || "null",
    ) as DemoData | null;
    if (
      saved?.hotels?.length &&
      saved?.rooms?.length &&
      saved?.orders &&
      saved?.accounts
    ) {
      const normalizedHotels = saved.hotels.map((h) => ({
        ...h,
        photos: Array.isArray(h.photos)
          ? h.photos
          : h.image
            ? [
                {
                  id: `legacy-${h.id}`,
                  url: h.image,
                  caption: h.caption || h.name,
                },
              ]
            : [],
      }));
      return expirePending({ ...saved, hotels: normalizedHotels });
    }
  } catch {
    /* Start with disposable demo fixtures when local data is unavailable. */
  }
  return createInitialData();
}
export function expirePending(data: DemoData): DemoData {
  let changed = false;
  const orders = data.orders.map((order) => {
    if (
      order.terminalAt &&
      Date.now() - order.terminalAt >= 7 * 86400000 &&
      order.phone
    ) {
      changed = true;
      return {
        ...order,
        phoneTail: order.phone.slice(-4),
        phone: "",
        name: "",
      };
    }
    if (order.status !== "待确认" || order.deadline > Date.now()) return order;
    changed = true;
    return {
      ...order,
      status: "已超时" as const,
      terminalAt: order.deadline,
      history: [
        ...order.history,
        { time: dateTime(order.deadline), text: "确认期限已到，预占已释放" },
      ],
    };
  });
  return changed ? { ...data, orders } : data;
}
export function hotelRooms(data: DemoData, hotel: string): Room[] {
  return data.rooms
    .filter((room) => !room.hotel || room.hotel === hotel)
    .map((room) => ({
      ...room,
      ...data.roomDetails?.[`${hotel}/${room.id}`],
    }));
}
export function hotelRoom(data: DemoData, hotel: string, id: string) {
  return hotelRooms(data, hotel).find((room) => room.id === id)!;
}
export function entryKey(hotel: string, room: string, date: string) {
  return `${hotel}/${room}/${date}`;
}
export function calendarEntry(
  data: DemoData,
  hotel: string,
  room: string,
  date: string,
): CalendarEntry {
  const value = data.calendar[entryKey(hotel, room, date)];
  if (data.connected) return value || { total: 0, price: 0, stopped: true, version: 0, occupied: 0 };

  return (
    value || {
      total: 12,
      price:
        hotelRoom(data, hotel, room).price +
        data.hotels.find((h) => h.id === hotel)!.offset,
      stopped: false,
      version: 1,
    }
  );
}
export function nightState(order: Order, date: string) {
  if (order.occupancy) return order.occupancy[date] || "已释放";
  if (order.status === "待确认")
    return order.deadline <= Date.now() ? "已释放" : "预占";
  if (order.status === "已确认") return "承诺";
  if (order.status === "已入住") return "在住占用";
  if (order.status === "已退房") {
    const checkout = order.checkout
      ? new Date(order.checkout)
      : new Date(`${order.end}T11:00:00+08:00`);
    const cutoff = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(checkout);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        hour12: false,
      }).format(checkout),
    );
    return date < (hour < 12 ? cutoff : addDays(cutoff, 1))
      ? "已消费"
      : "已释放";
  }
  return "已释放";
}
export function occupied(
  data: DemoData,
  hotel: string,
  room: string,
  date: string,
  exclude?: string,
) {
  if (data.connected) {
    const total = calendarEntry(data, hotel, room, date).occupied || 0;
    const own = exclude && data.orders.find((o) =>
      o.id === exclude && o.room === room && o.occupancy?.[date] === "承诺");
    if (own && total) return Math.max(0, total - own.rooms);
    return total;
  }
  return data.orders
    .filter(
      (o) =>
        o.id !== exclude &&
        o.hotel === hotel &&
        o.room === room &&
        o.start <= date &&
        date < o.end &&
        nightState(o, date) !== "已释放",
    )
    .reduce((sum, o) => sum + o.rooms, 0);
}
export function incidentBlocked(
  data: DemoData,
  hotel: string,
  room: string,
  date: string,
) {
  return data.incidents.some(
    (i) =>
      !i.closed &&
      i.hotel === hotel &&
      (!i.room || i.room === room) &&
      i.start <= date &&
      date < i.end,
  );
}
export function available(
  data: DemoData,
  hotel: string,
  room: string,
  date: string,
  exclude?: string,
) {
  const entry = calendarEntry(data, hotel, room, date);
  if (data.connected && (date < TODAY || (date === TODAY && Date.now() >= Date.parse(`${TODAY}T18:00:00+08:00`)))) {
    return 0;
  }
  return entry.stopped ||
    incidentBlocked(data, hotel, room, date) ||
    !data.hotels.find((h) => h.id === hotel)?.enabled ||
    !hotelRoom(data, hotel, room)?.enabled
    ? 0
    : Math.max(0, entry.total - occupied(data, hotel, room, date, exclude));
}
export function quote(
  data: DemoData,
  hotel: string,
  room: string,
  conditions: Pick<Conditions, "start" | "end">,
  delta = 0,
) {
  return days(conditions.start, conditions.end).map((date, i, arr) => ({
    date,
    price:
      calendarEntry(data, hotel, room, date).price +
      (i === arr.length - 1 ? delta : 0),
  }));
}
export function validConditions(c: Conditions): string {
  if (!c.city.trim()) return "请填写目的地城市。";
  if (!c.start || !c.end) return "请填写完整的入住与离店日期。";
  if (!isValidIsoDate(c.start) || !isValidIsoDate(c.end))
    return "请输入有效的公历日期。";
  const length = days(c.start, c.end).length;
  if (c.end <= c.start) return "离店日期应晚于入住日期。";
  if (c.start < TODAY) return "入住日期不能早于今天。";
  if (length < 1 || length > 14) return "请选择连续 1 至 14 晚。";
  if (!Number.isInteger(c.rooms) || c.rooms < 1 || c.rooms > 3)
    return "每单可预订 1 至 3 间。";
  if (!Number.isInteger(c.people) || c.people < c.rooms)
    return "总人数须为整数，且不少于房间数。";
  if (
    c.start === TODAY &&
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
    ) >= 18
  )
    return "今天的预订已截止，请选择未来的入住日期。";
  if (
    [c.min, c.max].some(
      (value) =>
        value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0),
    )
  )
    return "价格范围请填写非负金额。";
  if (c.min && c.max && Number(c.min) > Number(c.max))
    return "最低每晚价不能高于最高每晚价。";
  return "";
}
export function hotelPhotos(hotel?: Hotel | null): HotelPhoto[] {
  if (!hotel) return [];
  if (Array.isArray(hotel.photos)) return hotel.photos;
  return hotel.image
    ? [
        {
          id: `cover-${hotel.id}`,
          url: hotel.image,
          caption: hotel.caption || hotel.name,
        },
      ]
    : [];
}

export function roomUnavailableReason(
  data: DemoData,
  hotelId: string,
  room: Room,
  c: Conditions,
  exclude?: string,
): string {
  const resolved = hotelRoom(data, hotelId, room.id);
  if (!resolved) return "房型信息不存在";
  const hotel = data.hotels.find((h) => h.id === hotelId);
  if (hotel && !hotel.enabled) return "酒店当前未营业";
  if (!resolved.enabled) return "房型已停用";
  if (c.people > resolved.capacity * c.rooms) {
    return `人数超限（最多可住 ${resolved.capacity * c.rooms} 人）`;
  }
  const stayDates = days(c.start, c.end);
  if (!stayDates.length || c.start < TODAY) return "所选日期不可订";
  if (data.connected && c.start === TODAY) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
    );
    if (hour >= 18) return "今日 18:00 后不可预订当日入住";
  }
  for (const date of stayDates) {
    if (incidentBlocked(data, hotelId, resolved.id, date)) {
      return "所选日期异常停售";
    }
    const key = entryKey(hotelId, resolved.id, date);
    const hasEntry = Object.prototype.hasOwnProperty.call(data.calendar, key);
    const entry = calendarEntry(data, hotelId, resolved.id, date);
    if ((data.connected && !hasEntry) || entry.price <= 0) {
      return "所选日期暂未排期";
    }
    if (entry.stopped) {
      return "所选日期已停售";
    }
    if (available(data, hotelId, resolved.id, date, exclude) < c.rooms) {
      return "所选日期房量不足";
    }
  }
  return "";
}

export function roomBookable(
  data: DemoData,
  hotelId: string,
  room: Room,
  c: Conditions,
  exclude?: string,
): boolean {
  return roomUnavailableReason(data, hotelId, room, c, exclude) === "";
}

export function roomMatches(
  data: DemoData,
  hotel: string,
  room: Room,
  c: Conditions,
  exclude?: string,
) {
  room = hotelRoom(data, hotel, room.id);
  return (
    room.enabled &&
    (c.type === "all" || room.id === c.type || room.name === c.type) &&
    c.people <= room.capacity * c.rooms &&
    days(c.start, c.end).every((date) => {
      const entry = calendarEntry(data, hotel, room.id, date);
      return (
        entry.price > 0 &&
        available(data, hotel, room.id, date, exclude) >= c.rooms &&
        (!c.min || entry.price >= Number(c.min) * 100) &&
        (!c.max || entry.price <= Number(c.max) * 100)
      );
    })
  );
}
export function statistics(
  data: DemoData,
  hotel: string,
  start: string,
  end: string,
  room = "all",
) {
  const dates = days(start, end);
  const calendarRows = hotelRooms(data, hotel)
    .filter((r) => room === "all" || r.id === room)
    .flatMap((r) =>
      dates.map((date) => {
        const entry = calendarEntry(data, hotel, r.id, date);
        const used = occupied(data, hotel, r.id, date);
        return {
          date,
          room: r.id,
          ...entry,
          occupied: used,
          remaining: entry.total - used,
          available: available(data, hotel, r.id, date),
        };
      }),
    );
  const rows = data.orders
    .filter((o) => o.hotel === hotel && (room === "all" || o.room === room))
    .flatMap((o) =>
      o.nights
        .filter((n) => start <= n.date && n.date < end)
        .map((n) => ({
          order: o.id,
          date: n.date,
          room: o.room,
          rooms: o.rooms,
          status: o.status,
          state: nightState(o, n.date),
          price: n.price,
          effective: ["承诺", "在住占用", "已消费"].includes(
            nightState(o, n.date),
          )
            ? n.price * o.rooms
            : 0,
        })),
    );
  const count = (state: string) =>
    rows.filter((r) => r.state === state).reduce((sum, r) => sum + r.rooms, 0);
  return {
    calendarRows,
    rows,
    total: calendarRows.reduce((s, r) => s + r.total, 0),
    remaining: calendarRows.reduce((s, r) => s + r.remaining, 0),
    available: calendarRows.reduce((s, r) => s + r.available, 0),
    held: count("预占"),
    committed: count("承诺"),
    staying: count("在住占用"),
    consumed: count("已消费"),
    amount: rows.reduce((s, r) => s + r.effective, 0),
  };
}
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
