import type {
  Conditions,
  DemoData,
  Hotel,
  Incident,
  Night,
  Order,
  Role,
  Room,
  statistics,
} from "./model";

export const prototype = import.meta.env.MODE === "prototype";
const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const tokenKey = "hotel-session-v2";

export type Identity = {
  id: string;
  username: string;
  label: string;
  role: Role;
  hotel: string;
  enabled: boolean;
};
export type Credentials = {
  username: string;
  password: string;
  label?: string;
  hotel?: string;
};
type Stay = Pick<Conditions, "start" | "end" | "people" | "rooms"> & {
  room: string;
};
export type BookingInput = Stay & {
  name: string;
  phone: string;
  version?: number;
  nights: Night[];
};
export type Command = {
  action: string;
  id?: string;
  key?: string;
  hotel?: string;
  room?: string;
  note?: string;
  mode?: string;
  enabled?: boolean;
  booking?: BookingInput;
  calendar?: {
    date: string;
    total: number;
    price: number;
    stopped: boolean;
    version: number;
  }[];
  property?: Partial<Omit<Hotel, "offset">>;
  roomType?: Partial<Omit<Room, "price">>;
  incident?: Partial<Incident>;
  user?: Credentials;
};
export type CommandResult = {
  id?: string;
  order?: Order;
  phone?: string;
  problem?: { code: string; message: string; nights?: Night[] };
};
type State = DemoData & { account: Identity | null };
export type Quote = {
  room: string;
  hotel: string;
  total: number;
  available: number;
  nights: Night[];
};
export type Stats = ReturnType<typeof statistics> & {
  at: string;
  start: string;
  end: string;
  room: string;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public nights?: Night[],
    public order?: string,
    public date?: string,
  ) {
    super(message);
  }
}

export function getToken() {
  return sessionStorage.getItem(tokenKey) || "";
}

export function setToken(token: string) {
  if (token) sessionStorage.setItem(tokenKey, token);
  else sessionStorage.removeItem(tokenKey);
}

async function request<T>(
  path: string,
  payload?: unknown,
  token = getToken(),
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (payload !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}/api${path}`, {
    method: payload === undefined ? "GET" : "POST",
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(
      response.status,
      "transport",
      "无法读取服务器响应，请检查服务地址",
    );
  }
  const data = await response.json();
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.code,
      data.message,
      data.nights,
      data.order,
      data.date,
    );
  }
  return data as T;
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "暂时无法连接服务器，请稍后查回结果";
}

function query(path: string, fields: Record<string, string | number>) {
  return (
    path +
    "?" +
    new URLSearchParams(
      Object.entries(fields)
        .filter(([, value]) => value !== "")
        .map(([key, value]) => [key, String(value)]),
    ).toString()
  );
}

export function bookingInput(
  conditions: Conditions,
  room: string,
  name: string,
  phone: string,
  nights: Night[],
): BookingInput {
  return {
    room,
    start: conditions.start,
    end: conditions.end,
    people: conditions.people,
    rooms: conditions.rooms,
    name: name.trim(),
    phone,
    nights,
  };
}

export const api = {
  state: (token?: string) => request<State>("/state", undefined, token),
  login: (credentials: Credentials, register: boolean) =>
    request<{ account: Identity; token: string }>(
      register ? "/register" : "/login",
      credentials,
      "",
    ),
  logout: (token: string) => request("/logout", {}, token),
  command: (command: Command) => request<CommandResult>("/commands", command),
  order: (id: string) => request<Order>("/orders/" + encodeURIComponent(id)),
  orders: (filters: Record<string, string | number>) =>
    request<Order[]>(query("/orders", filters)),
  operation: (key: string) =>
    request<CommandResult>("/operations/" + encodeURIComponent(key)),
  quote: (hotel: string, stay: Stay, order = "") =>
    request<Quote>(query("/quote", { hotel, ...stay, order })),
  search: (conditions: Conditions, room = "", offset = 0) =>
    request<Quote[]>(
      query("/search", {
        city: conditions.city,
        start: conditions.start,
        end: conditions.end,
        people: conditions.people,
        rooms: conditions.rooms,
        room,
        min: conditions.min ? Math.round(Number(conditions.min) * 100) : "",
        max: conditions.max ? Math.round(Number(conditions.max) * 100) : "",
        limit: 100,
        offset,
      }),
    ),
  stats: (start: string, end: string, room: string) =>
    request<Stats>(query("/stats", { start, end, room })),
};

export function operationKey() {
  return crypto.randomUUID();
}
