import { useEffect, useRef, useState } from "react";
import {
  Avatar,
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
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Text,
  Textarea,
} from "@fluentui/react-components";
import {
  ArrowRight24Regular,
  CalendarLtr24Regular,
  Checkmark16Regular,
  Dismiss20Regular,
  Filter20Regular,
  Location20Regular,
} from "@fluentui/react-icons";
import { useApp } from "../context";
import {
  api,
  ApiError,
  bookingInput,
  errorMessage,
  operationKey,
} from "../api";
import type { Quote } from "../api";
import {
  activeStatuses,
  addDays,
  hotelPhotos,
  hotelRooms,
  hotelRoom,
  available,
  dateTime,
  days,
  initialConditions,
  isValidIsoDate,
  money,
  nightState,
  normalizeDigits,
  quote,
  roomBookable,
  roomMatches,
  roomUnavailableReason,
  shortDate,
  statuses,
  total,
  validConditions,
} from "../model";
import type { Conditions, Hotel, Night, Order } from "../model";
import {
  Back,
  ConditionsDialog,
  ConfirmDialog,
  Empty,
  Heading,
  NightQuote,
  NightStateBadge,
  Notice,
  Price,
  StaySummary,
  ConditionFields,
  Status,
} from "../components/shared";
import { FluentDatePicker } from "../components/DateField";
import { HotelImage } from "../components/HotelImage";
import { HotelGallery } from "../components/HotelGallery";

export function Explore() {
  const { data, conditions, setConditions, go, connected } = useApp();
  const [edit, setEdit] = useState(false),
    [filter, setFilter] = useState(false),
    [sort, setSort] = useState("editorial");
  const [liveOffers, setLiveOffers] = useState<Quote[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [offerOffset, setOfferOffset] = useState(0);
  useEffect(() => {
    setOfferOffset(0);
  }, [conditions]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    setLiveOffers(null);
    setSearchError("");
    void api
      .search(
        conditions,
        conditions.type === "all" ? "" : conditions.type,
        offerOffset,
      )
      .then((result) => {
        if (active) setLiveOffers(result);
      })
      .catch((error) => {
        if (active) {
          setLiveOffers([]);
          setSearchError(errorMessage(error));
        }
      });
    return () => {
      active = false;
    };
  }, [connected, conditions, offerOffset]);
  const offer = (hotel: Hotel) =>
    hotelRooms(data, hotel.id)
      .filter((room) =>
        connected
          ? liveOffers?.some((o) => o.room === room.id)
          : roomMatches(data, hotel.id, room, conditions),
      )
      .sort(
        (a, b) =>
          total(quote(data, hotel.id, a.id, conditions)) -
          total(quote(data, hotel.id, b.id, conditions)),
      )[0];
  const hotels = data.hotels.filter(
    (h) =>
      h.enabled && (connected || h.city === conditions.city.trim()) && offer(h),
  );
  if (sort === "price")
    hotels.sort(
      (a, b) =>
        total(quote(data, a.id, offer(a).id, conditions)) -
          total(quote(data, b.id, offer(b).id, conditions)) ||
        a.id.localeCompare(b.id),
    );
  const featured = hotels[0],
    count = days(conditions.start, conditions.end).length;
  const activeFilterCount =
    (conditions.type !== "all" ? 1 : 0) +
    (conditions.min !== "" ? 1 : 0) +
    (conditions.max !== "" ? 1 : 0);
  const hasFilters = activeFilterCount > 0;
  const activeFilterRoom =
    conditions.type !== "all"
      ? data.rooms.find((r) => r.id === conditions.type)?.name
      : "";
  const featuredPhotos = hotelPhotos(featured);
  return (
    <>
      <div className="search-context">
        <Button
          appearance="subtle"
          className="search-summary-trigger"
          aria-label="编辑搜索与住宿日期"
          onClick={() => setEdit(true)}
        >
          <span className="search-context-main">
            <span className="search-pill-city">
              <Location20Regular />
              <Text weight="semibold">{conditions.city}</Text>
            </span>
            <span className="search-pill-sep" aria-hidden="true" />
            <span className="search-pill-meta muted">
              {shortDate(conditions.start)} — {shortDate(conditions.end)} ·{" "}
              {conditions.people} 人 · {conditions.rooms} 间
            </span>
          </span>
        </Button>
        <div className="search-context-actions">
          {hasFilters && (
            <div className="inline">
              {activeFilterRoom && (
                <Badge appearance="tint" color="brand">
                  {activeFilterRoom}
                </Badge>
              )}
              {(conditions.min || conditions.max) && (
                <Badge appearance="tint" color="brand">
                  ¥{conditions.min || "0"} – {conditions.max ? `¥${conditions.max}` : "不限"}
                </Badge>
              )}
              <Button
                size="small"
                appearance="subtle"
                onClick={() =>
                  setConditions({ ...conditions, type: "all", min: "", max: "" })
                }
              >
                清除筛选
              </Button>
            </div>
          )}
          <Button
            icon={<Filter20Regular />}
            appearance={hasFilters ? "outline" : "subtle"}
            onClick={() => setFilter(true)}
          >
            筛选
            {activeFilterCount > 0 && (
              <Badge
                appearance="filled"
                color="brand"
                size="small"
                className="filter-count-badge"
              >
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>
      {connected && searchError && (
        <Notice intent="error">{searchError}</Notice>
      )}
      {connected && liveOffers === null ? (
        <Spinner label="正在查找可订房型" />
      ) : featured ? (
        <>
          <section className="hero">
            <div className="hero-intro">
              <Text className="eyebrow" size={200}>
                城市精选
              </Text>
              <Text as="h1" size={900} weight="semibold" className="hero-title">
                <span>在{conditions.city}，</span>
                <span>选一处</span>
                <span>舒适下榻。</span>
              </Text>
              <p className="hero-description">
                按入住日期实时查看整段可订房量与逐晚价格，透明对比后再预订。
              </p>
              <Button
                appearance="outline"
                className="condition-link"
                onClick={() => setEdit(true)}
              >
                <span className="inline">
                  <CalendarLtr24Regular />
                  <Text weight="semibold">
                    {shortDate(conditions.start)} — {shortDate(conditions.end)}
                  </Text>
                </span>
                <span className="muted">
                  {count} 晚 · {conditions.people} 人 · {conditions.rooms}{" "}
                  间　修改住宿条件 →
                </span>
              </Button>
            </div>
            <div className="feature">
              <div className="feature-image">
                <HotelImage
                  src={featuredPhotos[0]?.url || featured.image}
                  alt={
                    featured.description
                      ? `${featured.name}，${featured.description}`
                      : featured.name
                  }
                  hotelName={featured.name}
                  district={featured.district}
                  fetchPriority="high"
                />
                <span className="feature-photo-index" aria-hidden="true">
                  01 / {String(hotels.length).padStart(2, "0")}
                </span>
                {featuredPhotos.length > 1 && (
                  <span className="photo-count-pill">
                    {featuredPhotos.length} 张实景
                  </span>
                )}
              </div>
              <div className="hotel-ticket">
                <div className="ticket-info">
                  <span className="feature-tag">
                    {[
                      `01 / ${String(hotels.length).padStart(2, "0")}`,
                      featured.district,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <Text as="h2" size={700} weight="semibold">
                    {featured.name}
                  </Text>
                  {featured.caption && (
                    <p className="muted">{featured.caption}</p>
                  )}
                  <div className="ticket-price">
                    <Price
                      value={
                        quote(
                          data,
                          featured.id,
                          offer(featured).id,
                          conditions,
                        )[0].price
                      }
                    />
                    <span className="muted">起 / 每晚单间</span>
                    <span className="muted">
                      {count} 晚 {conditions.rooms} 间合计{" "}
                      {money(
                        total(
                          quote(
                            data,
                            featured.id,
                            offer(featured).id,
                            conditions,
                          ),
                          conditions.rooms,
                        ),
                      )}{" "}
                      起
                    </span>
                  </div>
                </div>
                <Button
                  appearance="primary"
                  size="large"
                  icon={<ArrowRight24Regular />}
                  iconPosition="after"
                  onClick={() => go(`/hotel/${featured.id}`)}
                >
                  查看房型
                </Button>
              </div>
              <div className="photo-caption">{featured.name} · 房间印象</div>
            </div>
          </section>
          {hotels.length > 1 && (
            <section aria-label="其他可订酒店">
              <div className="hotel-list-head">
                <Text as="h2" size={500} weight="semibold">
                  更多可订酒店
                </Text>
                <div className="inline">
                  <Text size={200} className="muted">
                    {hotels.length} 家符合当前条件
                  </Text>
                  <Select
                    aria-label="酒店排序"
                    value={sort}
                    onChange={(_, d) => setSort(d.value)}
                  >
                    <option value="editorial">图文浏览</option>
                    <option value="price">整段总价从低到高</option>
                  </Select>
                </div>
              </div>
              <div className="hotel-grid">
                {hotels.slice(1).map((h, index) => {
                  const hPhotos = hotelPhotos(h);
                  return (
                    <article
                      className="hotel-card"
                      key={h.id}
                      onClick={() => go(`/hotel/${h.id}`)}
                    >
                      <div className="hotel-card-media">
                        <HotelImage
                          src={hPhotos[0]?.url || h.image}
                          alt={h.description || h.name}
                          hotelName={h.name}
                          district={h.district}
                          loading="lazy"
                        />
                        {hPhotos.length > 1 && (
                          <span className="photo-count-pill">
                            {hPhotos.length} 张实景
                          </span>
                        )}
                      </div>
                      <div className="hotel-card-body">
                        <Text className="feature-tag" size={200}>
                          {[String(index + 2).padStart(2, "0"), h.district]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                        <Text as="h3" size={500} weight="semibold">
                          {h.name}
                        </Text>
                        {h.caption && (
                          <Text className="muted" size={200}>
                            {h.caption}
                          </Text>
                        )}
                        <p className="muted">
                          {offer(h).name} · 每间可住 {offer(h).capacity} 人
                        </p>
                        <Price
                          value={total(
                            quote(data, h.id, offer(h).id, conditions),
                            conditions.rooms,
                          )}
                        />
                        <Text className="muted" size={200}>
                          {count} 晚 {conditions.rooms} 间合计起
                        </Text>
                        <div>
                          <Button
                            appearance="subtle"
                            icon={<ArrowRight24Regular />}
                            iconPosition="after"
                            onClick={(e) => {
                              e.stopPropagation();
                              go(`/hotel/${h.id}`);
                            }}
                          >
                            查看房型
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <Heading title="未找到匹配酒店" eyebrow="探索酒店">
            没有找到整段可订的房型，当前条件已为你保留。
          </Heading>
          <Empty
            title="暂无匹配的酒店"
            action={
              <Button appearance="primary" onClick={() => setEdit(true)}>
                修改住宿条件
              </Button>
            }
          >
            可以调整日期、每晚价格范围、人数或房型。
          </Empty>
        </>
      )}
      <ConditionsDialog
        key={`edit-${edit}`}
        open={edit}
        onClose={() => setEdit(false)}
        value={conditions}
        onApply={setConditions}
      />
      {connected && (offerOffset > 0 || liveOffers?.length === 100) && (
        <div className="button-row space-top">
          <Button
            disabled={!offerOffset}
            onClick={() => setOfferOffset(offerOffset - 100)}
          >
            上一页房型
          </Button>
          <Button
            disabled={liveOffers?.length !== 100}
            onClick={() => setOfferOffset(offerOffset + 100)}
          >
            下一页房型
          </Button>
        </div>
      )}
      <ConditionsDialog
        key={`filter-${filter}`}
        open={filter}
        onClose={() => setFilter(false)}
        value={conditions}
        onApply={setConditions}
        filters
      />
      <p className="muted space-top">
        浏览和查询不占房；提交时会再次核对每一晚的价格与房量。
      </p>
    </>
  );
}

export function HotelPage({ id }: { id: string }) {
  const { data, conditions, setConditions, go, role } = useApp();
  const hotel = data.hotels.find((h) => h.id === id);
  const allRooms = hotelRooms(data, id);
  const matching = allRooms.filter((room) =>
    roomMatches(data, id, room, conditions),
  );
  const bookable = allRooms.filter((room) =>
    roomBookable(data, id, room, conditions),
  );
  const firstPreferredId = matching[0]?.id || bookable[0]?.id || "";
  const [selected, setSelected] = useState(
      () => firstPreferredId || allRooms[0]?.id || "",
    ),
    [edit, setEdit] = useState(false);
  const firstRoomId = allRooms[0]?.id || "";
  const hasSelected = allRooms.some((r) => r.id === selected);
  useEffect(() => {
    if (!firstRoomId) return;
    if (!hasSelected) setSelected(firstPreferredId || firstRoomId);
  }, [hasSelected, firstPreferredId, firstRoomId]);
  useEffect(() => {
    const currentRoom = hotelRoom(data, id, selected) || allRooms[0];
    if (
      firstPreferredId &&
      currentRoom &&
      !roomBookable(data, id, currentRoom, conditions)
    ) {
      setSelected(firstPreferredId);
    }
  }, [conditions, firstPreferredId]);
  if (!hotel) return <Empty title="未找到酒店" />;
  const room = hotelRoom(data, id, selected) || allRooms[0];
  const eyebrowText = [hotel.city, hotel.district].filter(Boolean).join(" / ");
  if (!room)
    return (
      <>
        <Back
          to={role === "staff" ? "/staff/hotel" : "/explore"}
          label={role === "staff" ? "返回酒店资料" : "返回酒店浏览"}
        />
        <Heading eyebrow={eyebrowText} title={hotel.name}>
          {hotel.address}
        </Heading>
        <Empty
          title="该酒店暂未配置可订房型"
          action={
            <Button
              onClick={() =>
                go(role === "staff" ? "/staff/hotel" : "/explore")
              }
            >
              {role === "staff" ? "返回酒店资料" : "返回酒店浏览"}
            </Button>
          }
        >
          请选择其他酒店或稍后再试。
        </Empty>
      </>
    );
  const selectedReason = roomUnavailableReason(data, id, room, conditions);
  const canBook = !selectedReason;
  const nights = quote(data, id, room.id, conditions);
  const hasNights = nights.length > 0 && nights.every((n) => n.price > 0);
  const remaining = Math.min(
    ...days(conditions.start, conditions.end).map((date) =>
      available(data, id, room.id, date),
    ),
  );
  const photos = hotelPhotos(hotel);
  return (
    <>
      <Back
        to={role === "staff" ? "/staff/hotel" : "/explore"}
        label={role === "staff" ? "返回酒店资料" : "返回酒店浏览"}
      />
      {role === "staff" && (
        <div className="space-bottom">
          <Notice intent="info">
            当前以工作人员视角预览顾客端选房页面；修改后的酒店资料与相册已实时同步到此视图。
          </Notice>
        </div>
      )}
      <Heading
        eyebrow={eyebrowText}
        title={hotel.name}
        action={
          <Button onClick={() => setEdit(true)} icon={<CalendarLtr24Regular />}>
            修改日期与人数
          </Button>
        }
      >
        {hotel.address}
      </Heading>
      <HotelGallery
        photos={photos}
        hotelName={hotel.name}
        district={hotel.district}
      />
      {hotel.description && (
        <p className="detail-description">{hotel.description}</p>
      )}
      <div className="two-columns hotel-selection">
        <section>
          <div className="section-label">
            <Text as="h2" size={600} weight="semibold">
              选择房型
            </Text>
            <Text className="muted" size={200}>
              按房型预订
            </Text>
          </div>
          <RadioGroup
            value={room.id}
            onChange={(_, d) => setSelected(d.value)}
            className="room-list"
            aria-label="选择房型"
          >
            {allRooms.map((r) => {
              const reason = roomUnavailableReason(data, id, r, conditions);
              const isBookable = !reason;
              const price = quote(data, id, r.id, conditions);
              const hasPrices =
                price.length > 0 && price.every((n) => n.price > 0);
              return (
                <div
                  className={`room-option ${room.id === r.id ? "selected" : ""} ${!isBookable ? "unavailable" : ""}`}
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                >
                  <Radio value={r.id} aria-label={r.name} />
                  <div className="room-description">
                    <Text weight="semibold" size={400}>
                      {r.name}
                    </Text>
                    <div className="room-specs">
                      <span className="room-spec-chip">{r.size} m²</span>
                      <span className="room-spec-chip">{r.bed}</span>
                      <span className="room-spec-chip">
                        每间可住 {r.capacity} 人
                      </span>
                    </div>
                    {r.description && <p className="muted">{r.description}</p>}
                  </div>
                  <div className="room-price">
                    {isBookable && hasPrices ? (
                      <>
                        <Price value={price[0].price} />
                        <Text className="muted" size={200}>
                          {price.length} 晚合计{" "}
                          {money(total(price, conditions.rooms))}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Badge appearance="tint" color="subtle">
                          当前不可订
                        </Badge>
                        <Text
                          className="muted room-unavailable-reason"
                          size={200}
                        >
                          {reason || "当前条件下不可订"}
                        </Text>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </RadioGroup>
          <div className="form-section space-top">
            <Text as="h2" size={500} weight="semibold">
              到店与预订
            </Text>
            <div className="facts">
              <div className="fact">
                <span className="fact-label">办理入住</span>
                <div className="fact-value">入住日 14:00 起</div>
              </div>
              <div className="fact">
                <span className="fact-label">约定离店</span>
                <div className="fact-value">离店日 12:00 前</div>
              </div>
              <div className="fact">
                <span className="fact-label">预订确认</span>
                <div className="fact-value">提交后 15 分钟内由酒店处理</div>
              </div>
              <div className="fact">
                <span className="fact-label">酒店电话</span>
                <div className="fact-value">{hotel.phone}</div>
              </div>
            </div>
          </div>
        </section>
        <aside className="aside-panel">
          <Text as="h2" size={500} weight="semibold">
            预订摘要
          </Text>
          <StaySummary conditions={conditions} onEdit={() => setEdit(true)} />
          <Text weight="semibold">{room.name}</Text>
          {hasNights && (
            <NightQuote nights={nights} rooms={conditions.rooms} />
          )}
          {canBook ? (
            <p className="muted space-top">
              当前住宿区间每晚至少剩余 {remaining} 间。
            </p>
          ) : (
            <div className="space-top">
              <Notice intent="warning">
                当前不可订：{selectedReason}。请选择其他房型或修改日期与人数。
              </Notice>
            </div>
          )}
          <Button
            className="primary-action"
            appearance="primary"
            size="large"
            disabled={!canBook || role !== "customer"}
            onClick={() => {
              sessionStorage.setItem(`hotel-room-${id}`, room.id);
              go(`/book/${id}`);
            }}
          >
            {role !== "customer" ? "预览中（仅顾客可预订）" : "填写预订"}
          </Button>
          <p className="muted space-top">提交时再次核对价格与房量。</p>
        </aside>
      </div>
      <ConditionsDialog
        key={String(edit)}
        open={edit}
        onClose={() => setEdit(false)}
        value={conditions}
        onApply={setConditions}
      />
      <div className="mobile-booking-bar">
        <div>
          {canBook && hasNights ? (
            <>
              <Price value={total(nights, conditions.rooms)} />
              <Text className="muted" size={200}>
                {nights.length} 晚 · {conditions.rooms} 间合计
              </Text>
            </>
          ) : (
            <>
              <Text weight="semibold">当前不可订</Text>
              <Text className="muted" size={200}>
                {selectedReason || "请调整房型或条件"}
              </Text>
            </>
          )}
        </div>
        <Button
          appearance="primary"
          disabled={!canBook || role !== "customer"}
          onClick={() => {
            sessionStorage.setItem(`hotel-room-${id}`, room.id);
            go(`/book/${id}`);
          }}
        >
          {role !== "customer" ? "预览中" : "填写预订"}
        </Button>
      </div>
    </>
  );
}

export function Booking({ id }: { id: string }) {
  const {
    data,
    update,
    conditions,
    go,
    scenario,
    audit,
    setScenario,
    connected,
    command,
  } = useApp();
  const hotel = data.hotels.find((h) => h.id === id)!;
  const roomId =
      sessionStorage.getItem(`hotel-room-${id}`) ||
      hotelRooms(data, id)[0]?.id ||
      "garden",
    room = hotelRoom(data, id, roomId);
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [consent, setConsent] = useState(false),
    [attempted, setAttempted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [priceDialog, setPriceDialog] = useState(false),
    [delta, setDelta] = useState(0),
    [result, setResult] = useState("");
  const locked = useRef(false);
  const [accepted, setAccepted] = useState<Night[]>([]);
  const [freshQuote, setFreshQuote] = useState<Night[]>();
  const storageKey = `hotel-book-operation-${id}`;
  const [uncertain, setUncertain] = useState(() =>
    connected ? sessionStorage.getItem(storageKey) || "" : "",
  );
  const [retryInput, setRetryInput] =
    useState<ReturnType<typeof bookingInput>>();
  const nights = connected
    ? accepted
    : quote(data, id, roomId, conditions, delta);
  useEffect(() => {
    if (!connected || !roomId) return;
    let active = true;
    void api
      .quote(id, {
        room: roomId,
        start: conditions.start,
        end: conditions.end,
        people: conditions.people,
        rooms: conditions.rooms,
      })
      .then((value) => {
        if (active) setAccepted(value.nights);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [connected, conditions, id, roomId]);
  const clearOperation = () => {
    sessionStorage.removeItem(storageKey);
    setUncertain("");
    setRetryInput(undefined);
  };
  const openResult = (orderId?: string) => {
    if (orderId) go(`/order/${orderId}`);
  };
  const checkResult = async () => {
    if (!uncertain || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const value = await api.operation(uncertain);
      clearOperation();
      if (value.problem) {
        if (value.problem.nights) {
          setFreshQuote(value.problem.nights);
          setPriceDialog(true);
        }
        setError(value.problem.message);
      } else openResult(value.id);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? "还没有查到处理结果。可以稍后再查回，或在输入相同的情况下重试同一提交。"
          : errorMessage(cause),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  if (!hotel || !room) return <Empty title="预订信息不存在" />;
  const nameError = attempted && !name.trim() ? "请填写联系姓名。" : "",
    phoneError =
      attempted && !/^1[3-9]\d{9}$/.test(phone)
        ? "请填写格式正确的 11 位中国大陆手机号。"
        : "";
  const submit = async () => {
    setAttempted(true);
    setError("");
    if (
      locked.current ||
      !name.trim() ||
      !/^1[3-9]\d{9}$/.test(phone) ||
      !consent
    )
      return;
    const invalid = validConditions(conditions);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (conditions.people > room.capacity * conditions.rooms) {
      setError("入住人数超过该房型容量，请返回修改人数或间数。");
      return;
    }
    if (connected) {
      if (!nights.length && !retryInput) {
        setError("当前没有可确认的逐晚报价，请返回选房并重新查询。");
        return;
      }
      locked.current = true;
      setBusy(true);
      const key = uncertain || operationKey();
      const input =
        retryInput || bookingInput(conditions, roomId, name, phone, nights);
      sessionStorage.setItem(storageKey, key);
      try {
        const value = await command({
          action: "book",
          key,
          hotel: id,
          booking: input,
        });
        clearOperation();
        openResult(value.id);
      } catch (cause) {
        if (
          cause instanceof ApiError &&
          cause.status < 500 &&
          cause.status !== 401
        ) {
          clearOperation();
          if (cause.code === "price_changed" && cause.nights) {
            setFreshQuote(cause.nights);
            setPriceDialog(true);
          }
          setError(
            cause.order
              ? `${cause.message}（${cause.order}）`
              : cause.date
                ? `${shortDate(cause.date)}不可订。请调整日期或房型。`
                : cause.message,
          );
        } else {
          setUncertain(key);
          setRetryInput(input);
          setError("暂时未收到预订结果。请查回本次提交，或重试同一请求。");
        }
      } finally {
        locked.current = false;
        setBusy(false);
      }
      return;
    }
    const duplicate = data.orders.find(
      (o) =>
        o.owner === "me" &&
        o.hotel === id &&
        o.room === roomId &&
        o.start === conditions.start &&
        o.end === conditions.end &&
        activeStatuses.includes(o.status),
    );
    if (duplicate) {
      setError(
        `已有同酒店、同房型、同日期的有效订单 ${duplicate.id}，可到“我的订单”查看或改订。`,
      );
      return;
    }
    if (!roomMatches(data, id, room, conditions)) {
      setError("住宿区间已不可订，请返回选房并重新查询。");
      return;
    }
    locked.current = true;
    setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 550));
    if (scenario === "price" && delta === 0) {
      setBusy(false);
      locked.current = false;
      setPriceDialog(true);
      audit("核对报价", id, "逐晚报价已变化，等待顾客重新同意", "需重新确认");
      return;
    }
    if (scenario === "unavailable") {
      setError(
        `${shortDate(nights[nights.length - 1].date)}的房量已发生变化，本次预订未创建。请返回选择其他房型或日期。`,
      );
      setBusy(false);
      locked.current = false;
      audit("提交预订", id, "整段房量不足；未创建订单", "失败");
      return;
    }
    const now = Date.now(),
      orderId = `HB${String(now).slice(-10)}`;
    const order: Order = {
      id: orderId,
      hotel: id,
      room: roomId,
      ...conditions,
      name: name.trim(),
      phone,
      status: "待确认",
      nights,
      created: now,
      deadline: now + 900000,
      version: 1,
      owner: "me",
      history: [
        {
          time: dateTime(now),
          text: "预订已提交，全部住宿日已预占，等待酒店确认",
        },
      ],
    };
    update((current) => ({ ...current, orders: [order, ...current.orders] }));
    audit(
      "创建订单",
      orderId,
      `待确认；${nights.length} 晚 ${conditions.rooms} 间；逐晚报价已保存`,
    );
    setBusy(false);
    locked.current = false;
    if (scenario === "uncertain") {
      setResult(orderId);
      return;
    }
    setScenario("normal");
    go(`/order/${orderId}`);
  };
  const updatedQuote = connected
    ? freshQuote || []
    : quote(data, id, roomId, conditions, 3000);
  const changedDates = new Set(
    updatedQuote
      .filter((n, idx) => nights[idx]?.price !== n.price)
      .map((n) => n.date),
  );
  const bookingCover = hotelPhotos(hotel)[0]?.url || hotel.image;
  return (
    <>
      <Back to={`/hotel/${id}`} label="返回房型选择" />
      <ol className="booking-steps" aria-label="预订步骤">
        <li className="step done">
          <span className="step-dot" aria-hidden="true">
            <Checkmark16Regular />
          </span>
          <span>01 选择房型</span>
        </li>
        <li className="step-line done" aria-hidden="true" />
        <li className="step active" aria-current="step">
          <span className="step-dot" aria-hidden="true">
            2
          </span>
          <strong>02 核对并提交</strong>
        </li>
        <li className="step-line" aria-hidden="true" />
        <li className="step">
          <span className="step-dot" aria-hidden="true">
            3
          </span>
          <span>03 酒店确认</span>
        </li>
      </ol>
      <Heading title="确认预订信息" eyebrow={`${hotel.name} · ${room.name}`}>
        核对住宿信息与逐晚报价，提交后由酒店在 15 分钟内确认。
      </Heading>
      <div className="two-columns">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <section className="form-section surface-card">
            <Text as="h2" size={500} weight="semibold">
              入住信息
            </Text>
            <StaySummary conditions={conditions} />
            <Text weight="semibold">{room.name}</Text>
            <p className="muted space-top">
              {room.bed} · 每间可住 {room.capacity} 人 · {conditions.rooms} 间
            </p>
          </section>
          <section className="form-section surface-card">
            <Text as="h2" size={500} weight="semibold">
              入住联系人
            </Text>
            <div className="form-grid">
              <Field
                label="联系姓名"
                required
                validationState={nameError ? "error" : "none"}
                validationMessage={nameError}
              >
                <Input
                  value={name}
                  onChange={(_, d) => setName(d.value)}
                  autoComplete="name"
                  maxLength={40}
                />
              </Field>
              <Field
                label="中国大陆手机号"
                required
                validationState={phoneError ? "error" : "none"}
                validationMessage={phoneError}
              >
                <Input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(_, d) =>
                    setPhone(normalizeDigits(d.value).replace(/\s+/g, ""))
                  }
                  autoComplete="tel-national"
                  maxLength={11}
                />
              </Field>
            </div>
            <p className="muted space-top">
              联系信息用于本订单的确认和履约。手机号仅作格式校验。
            </p>
          </section>
          <section className="form-section surface-card">
            <Text as="h2" size={500} weight="semibold">
              核对报价并提交
            </Text>
            <div className="mobile-quote-only">
              <NightQuote nights={nights} rooms={conditions.rooms} />
            </div>
            <div className="booking-submit-box">
              <Checkbox
                checked={consent}
                onChange={(_, d) => setConsent(Boolean(d.checked))}
                label={`我已核对入住信息、逐晚价格及整段总额 ${money(total(nights, conditions.rooms))}`}
              />
              {attempted && !consent && (
                <Text role="alert" size={200} className="field-inline-error">
                  请先核对并同意当前报价。
                </Text>
              )}
              {error && <Notice intent="error">{error}</Notice>}
              {connected && uncertain && (
                <div>
                  <Button disabled={busy} onClick={() => void checkResult()}>
                    查回预订结果
                  </Button>
                </div>
              )}
              {result ? (
                <div className="stack">
                  <Notice intent="warning">
                    提交结果暂未显示，请查回本次操作结果。重复点击不会再建一单。
                  </Notice>
                  <div>
                    <Button
                      appearance="primary"
                      onClick={() => {
                        setScenario("normal");
                        go(`/order/${result}`);
                      }}
                    >
                      查回预订结果
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button
                    type="submit"
                    appearance="primary"
                    size="large"
                    disabled={busy}
                    icon={busy ? <Spinner size="tiny" /> : undefined}
                  >
                    {busy
                      ? "正在核对并提交…"
                      : uncertain
                        ? "重试同一提交"
                        : "确认报价并提交预订"}
                  </Button>
                </div>
              )}
            </div>
            <p className="muted space-top">
              提交成功后为“待确认”；到期未确认会释放预占。此流程不包含线上支付。
            </p>
          </section>
        </form>
        <aside className="aside-panel">
          <HotelImage
            src={bookingCover}
            className="booking-photo"
            alt={`${hotel.name}房间示意`}
            hotelName={hotel.name}
            district={hotel.district}
          />
          <Text as="h2" size={600} weight="semibold">
            {hotel.name}
          </Text>
          <p className="muted space-top">
            {[hotel.district, room.name].filter(Boolean).join(" · ")}
          </p>
          <StaySummary conditions={conditions} />
          <NightQuote nights={nights} rooms={conditions.rooms} compact />
          <p className="muted space-top">
            人民币 · 每晚单间价 × 间数，无其他附加费用。
          </p>
        </aside>
      </div>
      <ConfirmDialog
        wide
        open={priceDialog}
        title="价格有更新，请重新核对"
        confirm="使用新报价，继续核对"
        onClose={() => setPriceDialog(false)}
        onConfirm={() => {
          if (connected && freshQuote) setAccepted(freshQuote);
          else setDelta(3000);
          setConsent(false);
          setPriceDialog(false);
          setError("报价已更新，请核对新价格并重新勾选同意后提交。");
        }}
      >
        <p className="muted">
          {connected
            ? "本次尚未创建订单，也未占房。请比较更新前后的价格。"
            : "本次尚未创建订单，也未占房。最后一晚的每晚单间价增加 30 元。"}
        </p>
        <div className="compare-grid space-top">
          <div className="compare-panel">
            <NightQuote
              label="上次报价"
              nights={nights}
              rooms={conditions.rooms}
            />
          </div>
          <div className="compare-panel new">
            <NightQuote
              label="当前报价"
              nights={updatedQuote}
              rooms={conditions.rooms}
              changedDates={changedDates}
            />
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}

export function Orders() {
  const { data, go, connected } = useApp();
  const [hotel, setHotel] = useState("all"),
    [state, setState] = useState("all"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [serverOrders, setServerOrders] = useState<Order[]>([]);
  const [listError, setListError] = useState("");
  useEffect(() => {
    setOffset(0);
  }, [hotel, state, start, end]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void api
      .orders({
        hotel: hotel === "all" ? "" : hotel,
        status: state === "all" ? "" : state,
        start,
        end,
        limit: 20,
        offset,
      })
      .then((orders) => {
        if (active) {
          setServerOrders(orders);
          setListError("");
        }
      })
      .catch((error) => {
        if (active) {
          setListError(errorMessage(error));
          setServerOrders([]);
        }
      });
    return () => {
      active = false;
    };
  }, [connected, hotel, state, start, end, offset, data.orders]);
  const orders = connected
    ? serverOrders
    : data.orders
        .filter(
          (o) =>
            o.owner === "me" &&
            (hotel === "all" || o.hotel === hotel) &&
            (state === "all" || o.status === state) &&
            (!start || o.start >= start) &&
            (!end || o.start < end),
        )
        .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  const activeFilterCount =
    (hotel !== "all" ? 1 : 0) +
    (state !== "all" ? 1 : 0) +
    (start !== "" ? 1 : 0) +
    (end !== "" ? 1 : 0);
  const hasFilters = activeFilterCount > 0;
  const resetFilters = () => {
    setHotel("all");
    setState("all");
    setStart("");
    setEnd("");
  };
  const filterFields = (
    <>
      <Field label="酒店">
        <Select value={hotel} onChange={(_, d) => setHotel(d.value)}>
          <option value="all">全部酒店</option>
          {data.hotels.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="订单状态">
        <Select value={state} onChange={(_, d) => setState(d.value)}>
          <option value="all">全部状态</option>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
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
    </>
  );
  return (
    <>
      <Heading
        eyebrow="顾客中心"
        title="我的订单"
        action={<Button onClick={() => go("/explore")}>继续探索酒店</Button>}
      >
        查看酒店确认、住宿安排与订单处理进度。
      </Heading>
      <div className="quick-filter-bar" role="group" aria-label="快捷状态筛选">
        {(
          [
            ["all", "全部订单"],
            ["待确认", "待确认"],
            ["已确认", "已确认"],
            ["已入住", "已入住"],
            ["已退房", "已退房"],
            ["已取消", "已取消"],
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
      <div className="mobile-orders-bar">
        <Text size={200} className="muted">
          {hasFilters ? `已筛选 ${activeFilterCount} 项条件` : `共 ${orders.length} 笔订单`}
        </Text>
        <div className="inline">
          {hasFilters && (
            <Button size="small" appearance="subtle" onClick={resetFilters}>
              重置
            </Button>
          )}
          <Button
            size="small"
            appearance={hasFilters ? "outline" : "secondary"}
            icon={<Filter20Regular />}
            onClick={() => setFilterOpen(true)}
          >
            筛选
            {activeFilterCount > 0 && (
              <Badge
                appearance="filled"
                color="brand"
                size="small"
                className="filter-count-badge"
              >
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>
      <div className="filter-bar orders-filter-bar">
        {filterFields}
        {hasFilters && (
          <Button appearance="subtle" onClick={resetFilters}>
            重置筛选
          </Button>
        )}
      </div>
      <OverlayDrawer
        open={filterOpen}
        position="bottom"
        className="mobile-filter-drawer"
        onOpenChange={(_, d) => setFilterOpen(d.open)}
      >
        <DrawerHeader>
          <DrawerHeaderTitle
            action={
              <Button
                appearance="subtle"
                icon={<Dismiss20Regular />}
                aria-label="关闭订单筛选"
                onClick={() => setFilterOpen(false)}
              />
            }
          >
            筛选我的订单
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody className="stack">{filterFields}</DrawerBody>
        <DrawerFooter className="mobile-filter-drawer-actions">
          {hasFilters && (
            <Button onClick={resetFilters}>重置筛选</Button>
          )}
          <Button appearance="primary" onClick={() => setFilterOpen(false)}>
            查看订单 ({orders.length})
          </Button>
        </DrawerFooter>
      </OverlayDrawer>
      {orders.length ? (
        <div className="order-list">
          {orders.map((order) => {
            const h = data.hotels.find((h) => h.id === order.hotel)!,
              r = hotelRoom(data, order.hotel, order.room);
            return (
              <article className="order-card" key={order.id}>
                <HotelImage
                  src={hotelPhotos(h)[0]?.url || h.image}
                  alt={`${h.name}房间示意`}
                  hotelName={h.name}
                  district={h.district}
                />
                <div className="order-main">
                  <div className="order-title">
                    <Text size={500} weight="semibold">
                      {h.name}
                    </Text>
                    <Status status={order.status} />
                    {order.incident && (
                      <Badge appearance="outline" color="warning">
                        有异常待处置
                      </Badge>
                    )}
                  </div>
                  <p>
                    {r.name} · {shortDate(order.start)} — {shortDate(order.end)}
                  </p>
                  <p className="muted">
                    {order.nights.length} 晚 · {order.people} 人 · {order.rooms}{" "}
                    间
                  </p>
                  <span className="order-number">
                    {order.id}
                    {order.status === "待确认"
                      ? ` · 确认截止 ${dateTime(order.deadline)}`
                      : ""}
                  </span>
                </div>
                <div className="order-side">
                  <div>
                    <Price value={total(order.nights, order.rooms)} />
                    <div className="muted">订单报价总额</div>
                  </div>
                  <Button onClick={() => go(`/order/${order.id}`)}>
                    查看订单
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title="没有符合条件的订单"
          action={
            <Button
              onClick={() => {
                setHotel("all");
                setState("all");
                setStart("");
                setEnd("");
              }}
            >
              清除筛选
            </Button>
          }
        >
          调整筛选条件，或去探索新的住宿。
        </Empty>
      )}
      {listError && <Notice intent="error">{listError}</Notice>}
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
    </>
  );
}

function useOrderDetail(id: string) {
  const { data, connected } = useApp();
  const summary = data.orders.find((o) => o.id === id);
  const [detail, setDetail] = useState<Order>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void api
      .order(id)
      .then((order) => {
        if (active) {
          setDetail(order);
          setError("");
        }
      })
      .catch((cause) => {
        if (active) {
          setDetail(undefined);
          setError(errorMessage(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [
    id,
    connected,
    summary?.status,
    summary?.version,
    summary?.incident,
    revision,
  ]);
  return {
    order: connected
      ? detail?.id === id
        ? detail
        : undefined
      : summary?.owner === "me"
        ? summary
        : undefined,
    error,
    reload: () => setRevision((v) => v + 1),
  };
}

export function OrderDetail({ id }: { id: string }) {
  const { data, update, go, audit, connected, command, notify } = useApp();
  const { order, error, reload } = useOrderDetail(id);
  const cancelKey = useRef({ note: "", key: "" });
  const [cancel, setCancel] = useState(false),
    [reason, setReason] = useState(""),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (order?.status !== "待确认") return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [order?.status]);
  if (connected && !order && !error) return <Spinner label="正在读取订单" />;
  if (!order)
    return (
      <Empty
        title="没有可查看的订单"
        action={<Button onClick={() => go("/orders")}>返回我的订单</Button>}
      >
        {error || "请从自己的订单列表进入。"}
      </Empty>
    );
  const hotel = data.hotels.find((h) => h.id === order.hotel)!,
    room = hotelRoom(data, order.hotel, order.room);
  const incident = data.incidents.find((i) => i.id === order.incident),
    item = incident?.items.find((i) => i.order === order.id);
  const remaining = Math.max(0, Math.ceil((order.deadline - now) / 60000));
  const contactAvailable =
    !order.terminalAt || now < order.terminalAt + 7 * 86400000;
  return (
    <>
      <Back to="/orders" label="返回我的订单" />
      <Heading
        eyebrow={`订单 ${order.id} · 版本 ${order.version}`}
        title={
          order.status === "待确认"
            ? "房间已预留，等待酒店确认"
            : order.status === "已确认"
              ? "住宿已确认，期待这次停留"
              : `你的预订${order.status}`
        }
        action={<Status status={order.status} />}
      >
        {hotel.name} · {room.name}
      </Heading>
      {order.status === "待确认" && (
        <div className="space-top">
          <Notice intent="info">
            酒店需在 {dateTime(order.deadline)} 前确认，当前约剩 {remaining}{" "}
            分钟。到期未确认将自动释放预占，你可以在这里查回最新状态。
          </Notice>
        </div>
      )}
      {incident && (
        <div className="space-top">
          <Notice intent="warning">
            酒店异常：{incident.title}。处置进度：{item?.progress || "未处理"}。
            {item?.notes} 请留意酒店联系。
          </Notice>
        </div>
      )}
      <div className="two-columns space-top">
        <section>
          <HotelImage
            className="booking-photo order-detail-photo"
            src={hotelPhotos(hotel)[0]?.url || hotel.image}
            alt={hotel.description || hotel.name}
            hotelName={hotel.name}
            district={hotel.district}
          />
          <div className="facts">
            <div className="fact">
              <span className="fact-label">入住 — 离店</span>
              <div className="fact-value">
                {shortDate(order.start)} — {shortDate(order.end)}
              </div>
            </div>
            <div className="fact">
              <span className="fact-label">房型与人数</span>
              <div className="fact-value">
                {room.name} · {order.people} 人 · {order.rooms} 间
              </div>
            </div>
            <div className="fact">
              <span className="fact-label">联系姓名</span>
              <div className="fact-value">
                {contactAvailable && order.name
                  ? order.name
                  : "联系信息已到期清理"}
              </div>
            </div>
            <div className="fact">
              <span className="fact-label">联系电话</span>
              <div className="fact-value">
                {contactAvailable && order.phone
                  ? order.phone
                  : `仅保留尾号 ${order.phoneTail || "—"}`}
              </div>
            </div>
            <div className="fact">
              <span className="fact-label">酒店位置</span>
              <div className="fact-value">{hotel.address}</div>
            </div>
            <div className="fact">
              <span className="fact-label">酒店电话</span>
              <div className="fact-value">{hotel.phone}</div>
            </div>
          </div>
          <section className="form-section">
            <Text as="h2" size={500} weight="semibold">
              订单处理记录
            </Text>
            <ol className="timeline">
              {[...order.history].reverse().map((event, i) => (
                <li key={i}>
                  <time>{event.time}</time>
                  <p>{event.text}</p>
                </li>
              ))}
            </ol>
          </section>
        </section>
        <aside className="aside-panel">
          <NightQuote
            nights={order.nights}
            rooms={order.rooms}
            label="订单逐晚报价"
          />
          <div className="space-top stack">
            {order.nights.map((n) => (
              <div className="section-label" key={n.date}>
                <span>{shortDate(n.date)}</span>
                <NightStateBadge state={nightState(order, n.date)} />
              </div>
            ))}
          </div>
          <p className="muted">
            报价为此订单版本保存的总额；已释放间夜不计入酒店有效间夜约定金额。
          </p>
          <div className="stack space-top">
            {order.status === "已确认" && !order.incident && (
              <Button
                appearance="primary"
                onClick={() => go(`/modify/${order.id}`)}
              >
                修改这次住宿
              </Button>
            )}
            {["待确认", "已确认"].includes(order.status) && !order.incident && (
              <Button onClick={() => setCancel(true)}>取消预订</Button>
            )}
            <Button
              onClick={() => {
                if (connected) reload();
                else update((current) => ({ ...current }));
              }}
            >
              查回最新状态
            </Button>
          </div>
        </aside>
      </div>
      <ConfirmDialog
        danger
        open={cancel}
        title="取消这次预订？"
        confirm="确认取消预订"
        onClose={() => setCancel(false)}
        onConfirm={async () => {
          if (connected) {
            if (!cancelKey.current.key || cancelKey.current.note !== reason) {
              cancelKey.current = { note: reason, key: operationKey() };
            }
            try {
              await command({
                action: "cancel",
                id,
                note: reason,
                key: cancelKey.current.key,
              });
              setCancel(false);
              reload();
            } catch (cause) {
              notify(errorMessage(cause), "error");
              reload();
            }
            return;
          }
          update((current) => ({
            ...current,
            orders: current.orders.map((o) =>
              o.id === id && ["待确认", "已确认"].includes(o.status)
                ? {
                    ...o,
                    status:
                      o.status === "待确认" && o.deadline <= Date.now()
                        ? "已超时"
                        : "已取消",
                    terminalAt: Date.now(),
                    history: [
                      ...o.history,
                      {
                        time: dateTime(),
                        text: `顾客取消预订${reason ? `：${reason}` : ""}；尚有效的占用已释放`,
                      },
                    ],
                  }
                : o,
            ),
          }));
          audit("取消订单", id, "顾客发起；释放尚有效占用");
          setCancel(false);
        }}
      >
        <p>取消后释放尚有效的房量，订单与逐晚报价记录保留。</p>
        <Field label="取消原因（选填）" className="space-top">
          <Textarea
            value={reason}
            onChange={(_, d) => setReason(d.value)}
            maxLength={200}
          />
        </Field>
      </ConfirmDialog>
    </>
  );
}

export function ModifyOrder({ id }: { id: string }) {
  const { connected } = useApp();
  const { order, error } = useOrderDetail(id);
  if (connected && !order && !error) return <Spinner label="正在读取订单" />;
  return <ModifyForm key={id} id={id} order={order} />;
}

function ModifyForm({ id, order }: { id: string; order?: Order }) {
  const { data, update, audit, go, connected, command } = useApp();
  const hotel = data.hotels.find((h) => h.id === order?.hotel);
  const [draft, setDraft] = useState<Conditions>(() =>
    order
      ? {
          ...initialConditions,
          start: order.start,
          end: order.end,
          people: order.people,
          rooms: order.rooms,
          city: hotel?.city || "南京",
        }
      : initialConditions,
  );
  const [roomId, setRoomId] = useState(order?.room || "garden"),
    [name, setName] = useState(order?.name || ""),
    [phone, setPhone] = useState(order?.phone || ""),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const expectedVersion = useRef(order?.version);
  const attempt = useRef({ fingerprint: "", key: "" });
  const [liveQuote, setLiveQuote] = useState<Night[]>();
  const changed = Boolean(
    order &&
    (draft.start !== order.start ||
      draft.end !== order.end ||
      draft.rooms !== order.rooms ||
      roomId !== order.room),
  );
  useEffect(() => {
    if (!connected || !changed || !hotel || !order) return;
    let active = true;
    setLiveQuote(undefined);
    setError("");
    void api
      .quote(
        hotel.id,
        {
          room: roomId,
          start: draft.start,
          end: draft.end,
          people: draft.people,
          rooms: draft.rooms,
        },
        id,
      )
      .then((value) => {
        if (active) setLiveQuote(value.nights);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [
    connected,
    changed,
    hotel?.id,
    id,
    draft.start,
    draft.end,
    draft.rooms,
    draft.people,
    roomId,
  ]);
  useEffect(
    () => setConsent(false),
    [draft.start, draft.end, draft.rooms, roomId],
  );
  if (!order || !hotel || order.status !== "已确认" || order.incident)
    return (
      <Empty
        title="当前订单无法在线改订"
        action={<Button onClick={() => go("/orders")}>返回我的订单</Button>}
      >
        已确认且尚未入住、没有履约异常的本人订单可在线修改。
      </Empty>
    );
  const room = hotelRoom(data, hotel.id, roomId);
  const reprice =
    draft.start !== order.start ||
    draft.end !== order.end ||
    draft.rooms !== order.rooms ||
    roomId !== order.room;
  const nights = reprice
    ? connected
      ? liveQuote || []
      : quote(data, hotel.id, roomId, draft)
    : order.nights;
  const save = async () => {
    if (busy) return;
    setError("");
    if (reprice) {
      const message = validConditions(draft);
      if (message) {
        setError(message);
        return;
      }
    }
    if (
      !Number.isInteger(draft.people) ||
      draft.people < draft.rooms ||
      draft.people > room.capacity * draft.rooms
    ) {
      setError("请检查入住人数，需不少于间数且不超过房型容量。");
      return;
    }
    if (!name.trim() || !/^1[3-9]\d{9}$/.test(phone)) {
      setError("请填写联系姓名与格式正确的 11 位中国大陆手机号。");
      return;
    }
    if (reprice && !consent) {
      setError("请先核对并同意新方案的逐晚报价与总额。");
      return;
    }
    if (order.version !== expectedVersion.current) {
      setError("订单已有更新，请返回订单详情查回最新版本后再修改。");
      return;
    }
    if (connected) {
      if (reprice && !nights.length) {
        setError("当前无可确认的新方案报价，原订单仍有效。");
        return;
      }
      const booking = {
        ...bookingInput(draft, roomId, name, phone, nights),
        version: expectedVersion.current,
      };
      const fingerprint = JSON.stringify(booking);
      if (attempt.current.fingerprint !== fingerprint)
        attempt.current = { fingerprint, key: operationKey() };
      setBusy(true);
      try {
        await command({
          action: "revise",
          id,
          booking,
          key: attempt.current.key,
        });
        go(`/order/${id}`);
      } catch (cause) {
        if (
          cause instanceof ApiError &&
          cause.code === "price_changed" &&
          cause.nights
        ) {
          setLiveQuote(cause.nights);
          setConsent(false);
        }
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (reprice && !roomMatches(data, hotel.id, room, draft, order.id)) {
      setError(
        "新方案有住宿日不可订，原订单与房量占用保持有效。请调整日期或房型。",
      );
      return;
    }
    if (
      data.orders.some(
        (o) =>
          o.id !== id &&
          o.owner === "me" &&
          o.hotel === hotel.id &&
          o.room === roomId &&
          o.start === draft.start &&
          o.end === draft.end &&
          activeStatuses.includes(o.status),
      )
    ) {
      setError("新方案与已有有效订单重复，原订单保持有效。");
      return;
    }
    if (
      !reprice &&
      draft.people === order.people &&
      name === order.name &&
      phone === order.phone
    ) {
      go(`/order/${id}`);
      return;
    }
    setBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    update((current) => ({
      ...current,
      orders: current.orders.map((o) =>
        o.id === id
          ? {
              ...o,
              start: draft.start,
              end: draft.end,
              people: draft.people,
              rooms: draft.rooms,
              room: roomId,
              name: name.trim(),
              phone,
              nights,
              version: o.version + 1,
              history: [
                ...o.history,
                {
                  time: dateTime(),
                  text: reprice
                    ? "改订成功：新方案替换原方案，保持已确认状态"
                    : "已更新人数或联系信息；原逐晚报价保持不变",
                },
              ],
            }
          : o,
      ),
    }));
    audit(
      "修改订单",
      id,
      reprice
        ? "顾客同意整单新报价；版本更新，保持已确认"
        : "修改人数或联系字段；未重新报价",
    );
    go(`/order/${id}`);
  };
  return (
    <>
      <Back to={`/order/${id}`} label="返回原订单" />
      <Heading eyebrow={`${hotel.name} · ${id}`} title="修改订单">
        在同一家酒店内修改日期、房型或人数。新方案成功前，原订单持续有效。
      </Heading>
      <Notice>
        仅修改人数或联系人时保留原报价；日期、房型或间数变化时重新核对整单报价。
      </Notice>
      <div className="two-columns space-top">
        <section>
          <div className="form-section">
            <Text as="h2" size={500} weight="semibold">
              新的住宿安排
            </Text>
            <ConditionFields value={draft} onChange={setDraft} showCity={false} />
            <Field label="新房型" className="space-top">
              <Select value={roomId} onChange={(_, d) => setRoomId(d.value)}>
                {hotelRooms(data, hotel.id)
                  .filter((r) => r.enabled)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <div className="form-section">
            <Text as="h2" size={500} weight="semibold">
              联系信息
            </Text>
            <div className="form-grid">
              <Field label="联系姓名">
                <Input value={name} onChange={(_, d) => setName(d.value)} />
              </Field>
              <Field label="手机号">
                <Input
                  type="tel"
                  value={phone}
                  onChange={(_, d) =>
                    setPhone(normalizeDigits(d.value).replace(/\s+/g, ""))
                  }
                />
              </Field>
            </div>
          </div>
          <div className="compare-grid">
            <div className="compare-panel">
              <Badge appearance="tint" color="subtle">
                原方案 · 持续有效
              </Badge>
              <Text as="h2" className="space-top" size={500} weight="semibold">
                {hotelRoom(data, order.hotel, order.room)?.name}
              </Text>
              <StaySummary
                conditions={{
                  ...draft,
                  start: order.start,
                  end: order.end,
                  people: order.people,
                  rooms: order.rooms,
                }}
              />
              <NightQuote
                nights={order.nights}
                rooms={order.rooms}
                label="原逐晚报价"
              />
            </div>
            <div className="compare-panel new">
              <Badge appearance="tint" color="brand">
                新方案 · 待核对
              </Badge>
              <Text as="h2" className="space-top" size={500} weight="semibold">
                {room.name}
              </Text>
              <StaySummary conditions={draft} />
              <NightQuote
                nights={nights}
                rooms={draft.rooms}
                label={reprice ? "新逐晚报价" : "保留原逐晚报价"}
              />
            </div>
          </div>
        </section>
        <aside className="aside-panel">
          <Text as="h2" size={500} weight="semibold">
            改订费用对比
          </Text>
          <div className="quote-total">
            <span>原报价</span>
            <Text>{money(total(order.nights, order.rooms))}</Text>
          </div>
          <div className="quote-total">
            <span>新报价</span>
            <Price value={total(nights, draft.rooms)} />
          </div>
          <p className="muted space-top">
            {reprice
              ? "整单使用新方案的当前逐晚价格，不只计算新增日期。"
              : "此次未变更日期、房型或间数，继续使用原订单价格。"}
          </p>
          {reprice && (
            <Checkbox
              checked={consent}
              onChange={(_, d) => setConsent(Boolean(d.checked))}
              label="我已核对并同意新方案的逐晚报价与总额"
            />
          )}
          {error && (
            <div className="space-top">
              <Notice intent="error">{error}</Notice>
            </div>
          )}
          <Button
            className="primary-action"
            size="large"
            appearance="primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "正在核对新方案…" : "确认修改"}
          </Button>
          <Button
            className="primary-action"
            appearance="subtle"
            onClick={() => go(`/order/${id}`)}
          >
            保留原方案
          </Button>
        </aside>
      </div>
    </>
  );
}

export function AuthPage({
  register = false,
  returnTo,
}: {
  register?: boolean;
  returnTo?: string;
}) {
  const { signIn, go, connected } = useApp();
  const [account, setAccount] = useState(""),
    [password, setPassword] = useState(""),
    [attempted, setAttempted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const role = await signIn(
        { username: account, password },
        Boolean(register),
      );
      const home =
        role === "staff"
          ? "/staff/calendar"
          : role === "admin"
            ? "/admin/incidents"
            : "/orders";
      const permitted =
        returnTo &&
        (role === "customer"
          ? !returnTo.startsWith("/staff") && !returnTo.startsWith("/admin")
          : returnTo.startsWith(`/${role}/`));
      go(permitted ? returnTo : home);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const minPassword = connected && register ? 10 : connected ? 1 : 6;
  return (
    <>
      <Back to="/explore" label="继续浏览酒店" />
      <div className="auth-layout">
        <div className="auth-image">
          <HotelImage
            src="/images/courtyard-room.png"
            alt="光线穿过庭院树叶，落在酒店房间的床边"
            hotelName="酒店预订系统"
          />
          <div className="auth-copy">
            <Text size={600} weight="semibold" className="auth-copy-title">
              实时房态与逐晚透明报价，
              <br />
              轻松安排每一次入住。
            </Text>
            <p className="muted space-top">
              在自己的订单里，查看每次住宿安排与确认进度。
            </p>
          </div>
        </div>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (account.trim() && password.length >= minPassword) void finish();
          }}
        >
          <div>
            <Text className="eyebrow" size={200}>
              酒店预订系统
            </Text>
            <Text as="h1" size={800} weight="semibold">
              {register ? "注册顾客账户" : "登录账户"}
            </Text>
            <p className="muted">
              {returnTo
                ? "登录后继续刚才的操作。"
                : register
                  ? "注册后可预订酒店、查看和调整住宿安排。"
                  : "登录后管理你的住宿与预订。"}
            </p>
          </div>
          <Field
            label="账户名"
            required
            validationState={attempted && !account.trim() ? "error" : "none"}
            validationMessage={
              attempted && !account.trim() ? "请填写账户名。" : undefined
            }
          >
            <Input
              value={account}
              onChange={(_, d) => setAccount(d.value)}
              autoComplete="username"
              placeholder={connected ? undefined : "演示账户名"}
            />
          </Field>
          <Field
            label="密码"
            required
            validationState={
              attempted && password.length < minPassword ? "error" : "none"
            }
            validationMessage={
              attempted && password.length < minPassword
                ? register || !connected
                  ? `密码至少填写 ${minPassword} 个字符。`
                  : "请填写密码。"
                : undefined
            }
          >
            <Input
              type="password"
              value={password}
              onChange={(_, d) => setPassword(d.value)}
              autoComplete={register ? "new-password" : "current-password"}
              placeholder={connected ? undefined : "演示密码"}
            />
          </Field>
          {error && <Notice intent="error">{error}</Notice>}
          <Button
            appearance="primary"
            size="large"
            type="submit"
            disabled={busy}
          >
            {busy ? "正在验证…" : register ? "注册并继续" : "登录并继续"}
          </Button>
          {!connected && (
            <Button onClick={() => void finish()}>使用顾客示例账户体验</Button>
          )}
          <p className="muted">
            {register ? "已有账户？" : "还没有账户？"}{" "}
            <Button
              appearance="transparent"
              onClick={() => go(register ? "/login" : "/register")}
            >
              {register ? "去登录" : "注册顾客账户"}
            </Button>
          </p>
          <Text size={200} className="muted">
            {connected
              ? "工作人员与管理员使用已分配的账户登录。"
              : "此处为登录交互演示，不连接真实账户服务。工作人员与管理员由平台分配。"}
          </Text>
        </form>
      </div>
    </>
  );
}

export function AccountPage() {
  const { go, signOut, identity } = useApp();
  return (
    <>
      <Heading eyebrow="顾客中心" title="个人中心">
        管理账户信息、订单入口与联系信息隐私规则。
      </Heading>
      <div className="settings-grid">
        <section className="settings-section">
          <div className="inline">
            <Avatar name={identity?.label || "顾客示例"} size={64} />
            <div>
              <Text size={600} weight="semibold">
                {identity?.label || "顾客示例账户"}
              </Text>
              <p className="muted">顾客 · 仅查看自己的订单</p>
            </div>
          </div>
          <div className="button-row space-top">
            <Button appearance="primary" onClick={() => go("/orders")}>
              查看我的订单
            </Button>
            <Button onClick={() => go("/explore")}>探索酒店</Button>
          </div>
        </section>
        <section className="settings-section">
          <Text as="h2" size={500} weight="semibold">
            联系信息与隐私
          </Text>
          <p className="muted">
            每次预订仅填写联系姓名和手机号；可在已确认、未入住的订单中修改。订单结束七天后，完整联系信息不再提供给业务用户。
          </p>
          <Button className="space-top" onClick={signOut}>
            {identity ? "退出登录" : "退出演示账户"}
          </Button>
        </section>
      </div>
    </>
  );
}
