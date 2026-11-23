CREATE TABLE IF NOT EXISTS hotels (
    id text PRIMARY KEY,
    name text NOT NULL,
    city text NOT NULL,
    address text NOT NULL,
    phone text NOT NULL,
    description text NOT NULL DEFAULT '',
    district text NOT NULL DEFAULT '',
    image text NOT NULL DEFAULT '',
    caption text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS rooms (
    id text PRIMARY KEY,
    hotel_id text NOT NULL REFERENCES hotels,
    name text NOT NULL,
    capacity integer NOT NULL CHECK (capacity > 0),
    size integer NOT NULL DEFAULT 0 CHECK (size >= 0),
    bed text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true,
    UNIQUE (hotel_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS active_room_name ON rooms (hotel_id, name) WHERE enabled;

CREATE TABLE IF NOT EXISTS calendar (
    room_id text NOT NULL REFERENCES rooms,
    date date NOT NULL,
    total integer NOT NULL CHECK (total >= 0),
    price bigint NOT NULL CHECK (price > 0),
    stopped boolean NOT NULL DEFAULT false,
    version integer NOT NULL CHECK (version > 0),
    PRIMARY KEY (room_id, date)
);

CREATE TABLE IF NOT EXISTS accounts (
    id text PRIMARY KEY,
    username text NOT NULL UNIQUE,
    label text NOT NULL,
    role text NOT NULL CHECK (role IN ('customer', 'staff', 'admin')),
    hotel_id text REFERENCES hotels,
    password text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    CHECK ((role = 'staff') = (hotel_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
    digest bytea PRIMARY KEY,
    account_id text NOT NULL REFERENCES accounts,
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id text PRIMARY KEY,
    customer_id text NOT NULL REFERENCES accounts,
    hotel_id text NOT NULL REFERENCES hotels,
    room_id text NOT NULL,
    starts date NOT NULL,
    ends date NOT NULL CHECK (ends > starts AND ends - starts <= 14),
    people integer NOT NULL,
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 3 AND people >= quantity),
    status text NOT NULL CHECK (status IN ('待确认', '已确认', '已入住', '已退房', '已取消', '已拒绝', '已超时')),
    version integer NOT NULL CHECK (version > 0),
    created_at timestamptz NOT NULL,
    deadline timestamptz NOT NULL,
    checkin_at timestamptz,
    checkout_at timestamptz,
    terminal_at timestamptz,
    FOREIGN KEY (hotel_id, room_id) REFERENCES rooms (hotel_id, id),
    CHECK ((status IN ('已退房', '已取消', '已拒绝', '已超时')) = (terminal_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS active_booking
    ON orders (customer_id, hotel_id, room_id, starts, ends)
    WHERE status IN ('待确认', '已确认', '已入住');
CREATE INDEX IF NOT EXISTS pending_booking ON orders (hotel_id, deadline) WHERE status = '待确认';
CREATE INDEX IF NOT EXISTS hotel_orders ON orders (hotel_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS customer_orders ON orders (customer_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS order_versions (
    order_id text NOT NULL REFERENCES orders,
    version integer NOT NULL,
    room_id text NOT NULL REFERENCES rooms,
    starts date NOT NULL,
    ends date NOT NULL,
    people integer NOT NULL,
    quantity integer NOT NULL,
    prices jsonb NOT NULL,
    total bigint NOT NULL CHECK (total > 0),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (order_id, version)
);

CREATE TABLE IF NOT EXISTS contacts (
    order_id text PRIMARY KEY REFERENCES orders,
    name text NOT NULL,
    phone text NOT NULL,
    tail text NOT NULL
);

CREATE TABLE IF NOT EXISTS occupancy (
    order_id text NOT NULL REFERENCES orders,
    date date NOT NULL,
    room_id text NOT NULL,
    version integer NOT NULL,
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 3),
    price bigint NOT NULL CHECK (price > 0),
    state text NOT NULL CHECK (state IN ('预占', '承诺', '在住占用', '已消费', '已释放')),
    PRIMARY KEY (order_id, date),
    FOREIGN KEY (order_id, version) REFERENCES order_versions (order_id, version),
    FOREIGN KEY (room_id, date) REFERENCES calendar (room_id, date)
);
CREATE INDEX IF NOT EXISTS occupancy_calendar ON occupancy (room_id, date) WHERE state <> '已释放';

CREATE TABLE IF NOT EXISTS order_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id text NOT NULL REFERENCES orders,
    happened_at timestamptz NOT NULL,
    message text NOT NULL
);
CREATE INDEX IF NOT EXISTS order_history_order ON order_history (order_id, id);

CREATE TABLE IF NOT EXISTS incidents (
    id text PRIMARY KEY,
    hotel_id text NOT NULL REFERENCES hotels,
    room_id text,
    starts date NOT NULL,
    ends date NOT NULL CHECK (ends > starts),
    title text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL,
    closed boolean NOT NULL DEFAULT false,
    FOREIGN KEY (hotel_id, room_id) REFERENCES rooms (hotel_id, id)
);
CREATE INDEX IF NOT EXISTS incidents_hotel ON incidents (hotel_id, starts, ends);
CREATE TABLE IF NOT EXISTS incident_orders (
    incident_id text NOT NULL REFERENCES incidents,
    order_id text NOT NULL REFERENCES orders,
    progress text NOT NULL CHECK (progress IN ('未处理', '联系中', '已处理')),
    notes text NOT NULL DEFAULT '',
    contact_at timestamptz,
    PRIMARY KEY (incident_id, order_id)
);
CREATE INDEX IF NOT EXISTS incident_order_history ON incident_orders (order_id, incident_id);

CREATE TABLE IF NOT EXISTS operations (
    actor_id text NOT NULL REFERENCES accounts,
    operation_key text NOT NULL,
    fingerprint bytea NOT NULL,
    result jsonb,
    PRIMARY KEY (actor_id, operation_key)
);

CREATE TABLE IF NOT EXISTS audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    happened_at timestamptz NOT NULL,
    actor_id text REFERENCES accounts,
    role text NOT NULL,
    hotel_id text REFERENCES hotels,
    action text NOT NULL,
    object text NOT NULL,
    detail text NOT NULL,
    result text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_hotel ON audit (hotel_id, id DESC);
CREATE INDEX IF NOT EXISTS audit_created_order ON audit (object)
    WHERE action = '提交预订' AND result = '成功';

CREATE TABLE IF NOT EXISTS hotel_photos (
    id text PRIMARY KEY,
    hotel_id text NOT NULL REFERENCES hotels ON DELETE CASCADE,
    sort_order integer NOT NULL DEFAULT 0,
    caption text NOT NULL DEFAULT '',
    content_type text NOT NULL DEFAULT '',
    data bytea NOT NULL DEFAULT ''::bytea,
    source_url text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotel_photos_hotel_idx
    ON hotel_photos (hotel_id, sort_order, created_at, id);

INSERT INTO hotel_photos(id, hotel_id, sort_order, caption, content_type, data, source_url)
SELECT 'seed-' || h.id || '-cover', h.id, 0,
       CASE WHEN h.caption <> '' THEN h.caption ELSE h.name END,
       '', ''::bytea, h.image
FROM hotels h
WHERE h.image <> ''
  AND NOT EXISTS (SELECT 1 FROM hotel_photos p WHERE p.hotel_id = h.id)
ON CONFLICT DO NOTHING;
