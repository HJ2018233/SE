package main

import (
	"context"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func listOrEmpty[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}

func readCatalog(ctx context.Context, tx pgx.Tx, a account, view *snapshot, now time.Time) error {
	private := a.Role == admin
	hotels, err := tx.Query(ctx, `
		SELECT id,name,city,address,phone,district,image,caption,description,enabled
		FROM hotels WHERE $1 OR id=$3 OR enabled OR EXISTS(
			SELECT 1 FROM orders o WHERE o.hotel_id=hotels.id AND o.customer_id=$2)
		ORDER BY CASE id WHEN 'qt' THEN 0 WHEN 'xw' THEN 1 ELSE 2 END,name,id`, private, a.ID, a.Hotel)
	if err != nil {
		return err
	}
	view.Hotels, err = pgx.CollectRows(hotels, pgx.RowToStructByPos[hotel])
	view.Hotels = listOrEmpty(view.Hotels)
	if err != nil {
		return err
	}
	rooms, err := tx.Query(ctx, `
		SELECT r.id,r.hotel_id,r.name,r.description,r.capacity,r.size,r.bed,r.enabled
		FROM rooms r JOIN hotels h ON h.id=r.hotel_id
		WHERE $1 OR r.hotel_id=$3 OR (r.enabled AND h.enabled) OR EXISTS(
			SELECT 1 FROM orders o WHERE o.room_id=r.id AND o.customer_id=$2)
		ORDER BY CASE WHEN r.id LIKE '%garden' THEN 0 ELSE 1 END,r.id`, private, a.ID, a.Hotel)
	if err != nil {
		return err
	}
	view.Rooms, err = pgx.CollectRows(rooms, pgx.RowToStructByPos[room])
	view.Rooms = listOrEmpty(view.Rooms)
	if err != nil {
		return err
	}

	rows, err := tx.Query(ctx, `
		SELECT r.hotel_id,c.room_id,c.date::text,c.total,c.price,
			c.stopped OR NOT (h.enabled AND r.enabled) OR EXISTS (
				SELECT 1 FROM incidents i WHERE i.hotel_id=h.id AND (i.room_id IS NULL OR i.room_id=r.id)
				  AND NOT i.closed AND c.date >= i.starts AND c.date < i.ends),
			c.version,COALESCE(x.occupied,0)
		FROM calendar c JOIN rooms r ON r.id=c.room_id JOIN hotels h ON h.id=r.hotel_id
		LEFT JOIN LATERAL (
			SELECT sum(quantity) AS occupied FROM occupancy
			WHERE room_id=c.room_id AND date=c.date AND state<>'已释放'
		) x ON true
		WHERE (h.enabled AND r.enabled OR $1='staff' AND r.hotel_id=$2)
			AND (c.date >= $3::text::date OR $1='staff' AND r.hotel_id=$2)
		ORDER BY c.date,r.id`, a.Role, a.Hotel, dateAt(now))
	if err != nil {
		return err
	}
	defer rows.Close()
	view.Calendar = make(map[string]calendarEntry)
	for rows.Next() {
		var hotelID, roomID, date string
		var entry calendarEntry
		if err := rows.Scan(&hotelID, &roomID, &date, &entry.Total, &entry.Price, &entry.Stopped,
			&entry.Version, &entry.Occupied); err != nil {
			return err
		}
		if a.Role != staff || a.Hotel != hotelID {
			entry.Total -= entry.Occupied
			entry.Occupied = 0
			entry.Version = 0
		}
		view.Calendar[hotelID+"/"+roomID+"/"+date] = entry
	}
	return rows.Err()
}

func orderList(ctx context.Context, tx pgx.Tx, a account, filters url.Values) ([]order, error) {
	orders := make([]order, 0)
	if a.ID == "" {
		return orders, nil
	}
	start, end := filters.Get("start"), filters.Get("end")
	for _, date := range []string{start, end} {
		if date != "" {
			if _, err := parseDate(date); err != nil {
				return nil, err
			}
		}
	}
	if start != "" && end != "" && start >= end {
		return nil, bad("入住日期筛选起日须早于止日")
	}
	limit, offset, err := pageParams(filters, 1000)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, orderProjection+`
		WHERE (($1='customer' AND o.customer_id=$2) OR ($1='staff' AND o.hotel_id=$3)
		OR ($1='admin' AND EXISTS(SELECT 1 FROM incident_orders io WHERE io.order_id=o.id)))
		AND ($4='' OR o.hotel_id=$4) AND ($5='' OR o.room_id=$5) AND ($6='' OR o.status=$6)
		AND (NULLIF($7,'') IS NULL OR o.starts >= NULLIF($7,'')::date)
		AND (NULLIF($8,'') IS NULL OR o.starts < NULLIF($8,'')::date)
        AND ($11='' OR strpos(lower(o.id),lower($11))>0)
		ORDER BY o.created_at DESC,o.id LIMIT $9 OFFSET $10`, a.Role, a.ID, a.Hotel,
		filters.Get("hotel"), filters.Get("room"), filters.Get("status"), start, end, limit, offset, filters.Get("search"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		orders = append(orders, o)
	}
	return orders, rows.Err()
}

func pageParams(filters url.Values, defaultLimit int) (int, int, error) {
	limit, offset := defaultLimit, 0
	if v := filters.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 1000 {
			return 0, 0, bad("分页大小须在 1 至 1000 之间")
		}
		limit = n
	}
	if v := filters.Get("offset"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return 0, 0, bad("分页起点无效")
		}
		offset = n
	}
	return limit, offset, nil
}

func incidentList(ctx context.Context, tx pgx.Tx, a account) ([]incident, error) {
	rows, err := tx.Query(ctx, `
		SELECT i.id,i.hotel_id,i.title,i.reason,i.starts::text,i.ends::text,COALESCE(i.room_id,''),i.closed,
		       COALESCE((SELECT jsonb_agg(jsonb_build_object('order',x.order_id,'progress',x.progress,'notes',x.notes,
			       'contactAt',COALESCE(x.contact_at::text,'')) ORDER BY x.order_id) FROM incident_orders x
			       WHERE x.incident_id=i.id AND ($1<>'customer' OR EXISTS(
			       SELECT 1 FROM orders o WHERE o.id=x.order_id AND o.customer_id=$2))),'[]'::jsonb)
		FROM incidents i WHERE $1='admin' OR ($1='staff' AND i.hotel_id=$3)
		     OR ($1='customer' AND EXISTS(SELECT 1 FROM incident_orders x JOIN orders o ON o.id=x.order_id
		         WHERE x.incident_id=i.id AND o.customer_id=$2))
		ORDER BY i.created_at DESC,i.id`, a.Role, a.ID, a.Hotel)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[incident])
	return listOrEmpty(items), err
}

func auditList(ctx context.Context, tx pgx.Tx, a account) ([]auditEntry, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text,happened_at,role,action,object,detail,result FROM audit
		WHERE $1='admin' OR ($1='staff' AND hotel_id=$2)
		ORDER BY id DESC LIMIT 1000`, a.Role, a.Hotel)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]auditEntry, 0)
	labels := map[string]string{customer: "顾客", staff: "酒店工作人员", admin: "平台管理员", "system": "系统"}
	for rows.Next() {
		var item auditEntry
		var at time.Time
		if err := rows.Scan(&item.ID, &at, &item.Role, &item.Action, &item.Object, &item.Detail, &item.Result); err != nil {
			return nil, err
		}
		item.At = eventTime(at)
		item.Role = labels[item.Role]
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *service) snapshot(ctx context.Context, token string) (view snapshot, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var a account
		if token != "" {
			var err error
			a, err = actor(ctx, tx, token, s.clock())
			if err != nil {
				return err
			}
			view.Account = &a
		}
		if err := lockHotels(ctx, tx, ""); err != nil {
			return err
		}
		now := s.clock()
		if err := expirePending(ctx, tx, "", now); err != nil {
			return err
		}
		if err := readCatalog(ctx, tx, a, &view, now); err != nil {
			return err
		}
		var err error
		if view.Orders, err = orderList(ctx, tx, a, nil); err != nil {
			return err
		}
		if view.Incidents, err = incidentList(ctx, tx, a); err != nil {
			return err
		}
		if view.Audit, err = auditList(ctx, tx, a); err != nil {
			return err
		}
		view.Accounts = make([]account, 0)
		if a.Role == admin {
			rows, err := tx.Query(ctx, `
				SELECT id,username,label,role,COALESCE(hotel_id,''),enabled
				FROM accounts WHERE role IN ('staff','admin') ORDER BY role,username`)
			if err != nil {
				return err
			}
			view.Accounts, err = pgx.CollectRows(rows, pgx.RowToStructByPos[account])
			view.Accounts = listOrEmpty(view.Accounts)
			return err
		}
		return nil
	})
	return view, err
}

func (s *service) orderDetail(ctx context.Context, token, id string) (o order, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		a, err := actor(ctx, tx, token, s.clock())
		if err != nil {
			return err
		}
		h, err := commandHotel(ctx, tx, a, command{Action: "revise", ID: id})
		if err != nil {
			return err
		}
		if err := lockHotel(ctx, tx, h); err != nil {
			return err
		}
		now := s.clock()
		if err := expirePending(ctx, tx, h, now); err != nil {
			return err
		}
		o, err = readOrder(ctx, tx, id)
		if err != nil {
			return err
		}
		if a.Role == admin {
			var linked bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM incident_orders WHERE order_id=$1)", id).Scan(&linked); err != nil {
				return err
			}
			if linked {
				return nil
			}
		}
		if !orderScope(a, o) {
			return missing()
		}
		if a.Role == customer && contactAllowed(o, now) {
			return tx.QueryRow(ctx, "SELECT name,phone FROM contacts WHERE order_id=$1", id).Scan(&o.Name, &o.Phone)
		}
		return nil
	})
	return o, err
}

func (s *service) findOrders(ctx context.Context, token string, filters url.Values) (orders []order, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		a, err := actor(ctx, tx, token, s.clock())
		if err != nil {
			return err
		}
		if err := lockHotels(ctx, tx, a.Hotel); err != nil {
			return err
		}
		if err := expirePending(ctx, tx, a.Hotel, s.clock()); err != nil {
			return err
		}
		orders, err = orderList(ctx, tx, a, filters)
		return err
	})
	return orders, err
}

type offer struct {
	Room      string  `json:"room"`
	Hotel     string  `json:"hotel"`
	Nights    []night `json:"nights"`
	Available int     `json:"available"`
	Total     int64   `json:"total"`
}

func filterPrice(filters url.Values, key string) (int64, error) {
	v := filters.Get(key)
	if v == "" {
		return 0, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 0 || n > maxPrice {
		return 0, bad("请填写有效的价格区间")
	}
	return n, nil
}

func (s *service) search(ctx context.Context, filters url.Values) (offers []offer, err error) {
	v := stay{Room: "search", Start: filters.Get("start"), End: filters.Get("end")}
	v.People, _ = strconv.Atoi(filters.Get("people"))
	v.Rooms, _ = strconv.Atoi(filters.Get("rooms"))
	if _, err := validateStay(v); err != nil {
		return nil, err
	}
	low, err := filterPrice(filters, "min")
	if err != nil {
		return nil, err
	}
	high, err := filterPrice(filters, "max")
	if err != nil {
		return nil, err
	}
	if high != 0 && low > high {
		return nil, bad("价格上限须不低于下限")
	}
	limit, offset, err := pageParams(filters, 100)
	if err != nil {
		return nil, err
	}
	offers = make([]offer, 0)
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockHotels(ctx, tx, filters.Get("hotel")); err != nil {
			return err
		}
		now := s.clock()
		if err := validateSale(v, now); err != nil {
			return err
		}
		if err := expirePending(ctx, tx, filters.Get("hotel"), now); err != nil {
			return err
		}
		type pair struct{ Hotel, Room string }
		rows, err := tx.Query(ctx, `
			SELECT h.id,r.id FROM hotels h JOIN rooms r ON r.hotel_id=h.id
			WHERE h.enabled AND r.enabled AND ($1='' OR strpos(lower(h.city),lower($1))>0)
			  AND ($2='' OR h.id=$2) AND ($3='' OR r.id=$3 OR r.name=$3)
			  AND r.capacity*$4 >= $5`, strings.TrimSpace(filters.Get("city")),
			filters.Get("hotel"), filters.Get("room"), v.Rooms, v.People)
		if err != nil {
			return err
		}
		pairs, err := pgx.CollectRows(rows, pgx.RowToStructByPos[pair])
		if err != nil {
			return err
		}
		for _, item := range pairs {
			v.Room = item.Room
			nights, available, err := quoteStay(ctx, tx, item.Hotel, v, "", now)
			if p := asProblem(err); p != nil && p.Code == "unavailable" {
				continue
			}
			if err != nil {
				return err
			}
			matches := true
			for _, n := range nights {
				matches = matches && n.Price >= low && (high == 0 || n.Price <= high)
			}
			if matches {
				offers = append(offers, offer{Room: item.Room, Hotel: item.Hotel, Nights: nights,
					Available: available, Total: totalPrice(nights, v.Rooms)})
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	slices.SortFunc(offers, func(a, b offer) int {
		if a.Total != b.Total {
			if a.Total < b.Total {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Room, b.Room)
	})
	first := min(offset, len(offers))
	return offers[first : first+min(limit, len(offers)-first)], nil
}

func (s *service) quote(ctx context.Context, token, hotelID, existing string, v stay) (out offer, err error) {
	var declined *problem
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if existing != "" {
			a, err := actor(ctx, tx, token, s.clock())
			if err != nil {
				return err
			}
			if a.Role != customer {
				return forbidden()
			}
			hotelID, err = commandHotel(ctx, tx, a, command{Action: "revise", ID: existing})
			if err != nil {
				return err
			}
		}
		if err := lockHotel(ctx, tx, hotelID); err != nil {
			return err
		}
		now := s.clock()
		if err := expirePending(ctx, tx, hotelID, now); err != nil {
			return err
		}
		if existing != "" {
			o, err := readOrder(ctx, tx, existing)
			if err != nil {
				return err
			}
			if o.Status != confirmed || o.Incident != "" {
				return conflict("order_state", "当前订单无法改订")
			}
		}
		nights, available, err := quoteStay(ctx, tx, hotelID, v, existing, now)
		out = offer{Hotel: hotelID, Room: v.Room, Nights: nights, Available: available, Total: totalPrice(nights, v.Rooms)}
		if declined = asProblem(err); declined != nil {
			return nil
		}
		return err
	})
	if err == nil && declined != nil {
		return out, declined
	}
	return out, err
}

func addSampleCatalog(ctx context.Context, tx pgx.Tx, now time.Time) error {
	samples := []hotel{
		{ID: "qt", Name: "秦淮 · 栖庭", City: "南京", Address: "南京市秦淮区庭院路 18 号（示例地址）", Phone: "025-00000001", District: "秦淮区", Image: "/images/courtyard-room.png", Caption: "把庭院，留在窗边。", Description: "木色、晨光与一方安静的庭院。"},
		{ID: "xw", Name: "玄武 · 湖畔", City: "南京", Address: "南京市玄武区湖景路 26 号（示例地址）", Phone: "025-00000002", District: "玄武区", Image: "/images/lake-room.png", Caption: "醒来，正好看见湖。", Description: "清晨的湖光和一杯热茶。"},
		{ID: "ys", Name: "阅江 · 泊舍", City: "南京", Address: "南京市鼓楼区泊园路 9 号（示例地址）", Phone: "025-00000003", District: "鼓楼区", Image: "/images/garden-entrance.png", Caption: "入一扇门，换一种步调。", Description: "灰砖与暖木围合的小院。"},
	}
	for idx, h := range samples {
		tag, err := tx.Exec(ctx, `
			INSERT INTO hotels(id,name,city,address,phone,district,image,caption,description)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
			h.ID, h.Name, h.City, h.Address, h.Phone, h.District, h.Image, h.Caption, h.Description)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		for _, room := range []struct {
			suffix, name, bed string
			price, size       int
		}{
			{"garden", "庭院大床房", "1 张 1.8m 大床", 46800, 32},
			{"window", "临窗大床房", "1 张 1.8m 大床", 49800, 35},
			{"twin", "双床客房", "2 张 1.2m 单人床", 52800, 36},
		} {
			id := h.ID + "-" + room.suffix
			if err := sqlExec(ctx, tx, "INSERT INTO rooms(id,hotel_id,name,capacity,bed,size) VALUES($1,$2,$3,2,$4,$5)",
				id, h.ID, room.name, room.bed, room.size); err != nil {
				return err
			}
			if err := sqlExec(ctx, tx, `
				INSERT INTO calendar(room_id,date,total,price,version)
				SELECT $1,$2::text::date + d,4,$3::bigint + CASE WHEN d%7 IN (5,6) THEN 3000 ELSE 0 END,1
				FROM generate_series(0,89) d`, id, dateAt(now), room.price+idx*4000); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *service) seed(ctx context.Context) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := sqlExec(ctx, tx, "SELECT pg_advisory_xact_lock(1687629329)"); err != nil {
			return err
		}
		return addSampleCatalog(ctx, tx, s.clock())
	})
}
