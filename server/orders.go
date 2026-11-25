package main

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
)

const orderProjection = `
	SELECT o.id,o.customer_id,o.hotel_id,o.room_id,o.starts::text,o.ends::text,o.people,o.quantity,o.status,o.version,
	       v.prices,o.created_at,o.deadline,o.terminal_at,o.checkout_at,c.tail,
	       COALESCE((SELECT i.id FROM incidents i JOIN incident_orders l ON l.incident_id=i.id
	                 WHERE l.order_id=o.id AND NOT i.closed ORDER BY i.created_at DESC LIMIT 1),''),
	       COALESCE((SELECT jsonb_object_agg(x.date,x.state) FROM occupancy x
	                 WHERE x.order_id=o.id AND x.version=o.version),'{}'::jsonb),
	       COALESCE((SELECT jsonb_agg(jsonb_build_object('time',h.happened_at,'text',h.message) ORDER BY h.id)
	                 FROM order_history h WHERE h.order_id=o.id),'[]'::jsonb)
	FROM orders o JOIN order_versions v ON (o.id,o.version)=(v.order_id,v.version)
	JOIN contacts c ON c.order_id=o.id `

func scanOrder(row interface{ Scan(...any) error }) (order, error) {
	var o order
	var created, deadline time.Time
	var terminal, checkout *time.Time
	err := row.Scan(&o.ID, &o.Owner, &o.Hotel, &o.Room, &o.Start, &o.End, &o.People, &o.Rooms, &o.Status,
		&o.Version, &o.Nights, &created, &deadline, &terminal, &checkout, &o.PhoneTail,
		&o.Incident, &o.Occupancy, &o.History)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, missing()
	}
	if err != nil {
		return o, err
	}
	o.Created = created.UnixMilli()
	o.Deadline = deadline.UnixMilli()
	if terminal != nil {
		o.TerminalAt = terminal.UnixMilli()
	}
	if checkout != nil {
		o.Checkout = eventTime(*checkout)
	}
	return o, nil
}

func readOrder(ctx context.Context, tx pgx.Tx, id string) (order, error) {
	return scanOrder(tx.QueryRow(ctx, orderProjection+" WHERE o.id=$1", id))
}

func orderScope(a account, o order) bool {
	switch a.Role {
	case customer:
		return a.ID == o.Owner
	case staff:
		return a.Hotel == o.Hotel
	case admin:
		return o.Incident != ""
	}
	return false
}

func contactAllowed(o order, now time.Time) bool {
	return o.TerminalAt == 0 || now.UnixMilli() < o.TerminalAt+(7*24*time.Hour).Milliseconds()
}

func duplicateOrder(ctx context.Context, tx pgx.Tx, owner, hotelID string, v stay, except string) error {
	var id string
	err := tx.QueryRow(ctx, `
		SELECT id FROM orders WHERE customer_id=$1 AND hotel_id=$2 AND room_id=$3
		AND starts=$4::text::date AND ends=$5::text::date AND id<>$6 AND status IN ('待确认','已确认','已入住')`,
		owner, hotelID, v.Room, v.Start, v.End, except).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	p := conflict("duplicate_order", "同一酒店、房型和日期已有有效订单")
	p.Order = id
	return p
}

func saveVersion(ctx context.Context, tx pgx.Tx, o order, now time.Time) error {
	return sqlExec(ctx, tx, `
		INSERT INTO order_versions(order_id,version,room_id,starts,ends,people,quantity,prices,total,created_at)
		VALUES($1,$2,$3,$4::text::date,$5::text::date,$6,$7,$8,$9,$10)`,
		o.ID, o.Version, o.Room, o.Start, o.End, o.People, o.Rooms, o.Nights, totalPrice(o.Nights, o.Rooms), now)
}

func saveContact(ctx context.Context, tx pgx.Tx, o order, b booking) error {
	return sqlExec(ctx, tx, `
		INSERT INTO contacts(order_id,name,phone,tail) VALUES($1,$2,$3,right($3,4))
		ON CONFLICT (order_id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,tail=EXCLUDED.tail`,
		o.ID, b.Name, b.Phone)
}

func saveOccupancy(ctx context.Context, tx pgx.Tx, o order, state string) error {
	for _, n := range o.Nights {
		if err := sqlExec(ctx, tx, `
			INSERT INTO occupancy(order_id,date,room_id,version,quantity,price,state)
			VALUES($1,$2::text::date,$3,$4,$5,$6,$7)
			ON CONFLICT (order_id,date) DO UPDATE SET room_id=EXCLUDED.room_id,version=EXCLUDED.version,
				quantity=EXCLUDED.quantity,price=EXCLUDED.price,state=EXCLUDED.state`,
			o.ID, n.Date, o.Room, o.Version, o.Rooms, n.Price, state); err != nil {
			return err
		}
	}
	return nil
}

func createBooking(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	b := c.Booking
	b.Name = cleanText(b.Name, 40)
	if b.Name == "" || !phonePattern.MatchString(b.Phone) {
		return result{}, bad("请填写联系姓名和有效的中国大陆手机号")
	}
	if _, err := validateStay(b.stay); err != nil {
		return result{}, err
	}
	if err := duplicateOrder(ctx, tx, a.ID, c.Hotel, b.stay, ""); err != nil {
		return result{}, err
	}
	prices, _, err := quoteStay(ctx, tx, c.Hotel, b.stay, "", now)
	if err != nil {
		return result{}, err
	}
	if err := validateAcceptedQuote(b.Nights, prices); err != nil {
		return result{}, err
	}
	o := order{ID: randomID("HB"), Owner: a.ID, Hotel: c.Hotel, stay: b.stay, Nights: prices, Version: 1}
	if err := sqlExec(ctx, tx, `
		INSERT INTO orders(id,customer_id,hotel_id,room_id,starts,ends,people,quantity,status,version,created_at,deadline)
		VALUES($1,$2,$3,$4,$5::text::date,$6::text::date,$7,$8,'待确认',1,$9,$10)`,
		o.ID, a.ID, o.Hotel, o.Room, o.Start, o.End, o.People, o.Rooms, now, now.Add(15*time.Minute)); err != nil {
		return result{}, err
	}
	if err := saveVersion(ctx, tx, o, now); err != nil {
		return result{}, err
	}
	if err := saveContact(ctx, tx, o, b); err != nil {
		return result{}, err
	}
	if err := saveOccupancy(ctx, tx, o, held); err != nil {
		return result{}, err
	}
	if err := history(ctx, tx, now, o.ID, "已预占全部房间，等待酒店确认"); err != nil {
		return result{}, err
	}
	return result{ID: o.ID}, audit(ctx, tx, now, a, o.Hotel, "提交预订", o.ID, "保存逐晚报价并预占全部住宿日", "成功")
}

func reviseBooking(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	o, err := readOrder(ctx, tx, c.ID)
	if err != nil {
		return result{}, err
	}
	if !orderScope(a, o) {
		return result{}, missing()
	}
	if o.Status != confirmed || o.Incident != "" {
		return result{}, conflict("order_state", "只有尚未入住、无履约异常的已确认订单可改订")
	}
	b := c.Booking
	if b.Version != o.Version {
		return result{}, conflict("version", "订单已有更新，请返回详情查回最新状态")
	}
	b.Name = cleanText(b.Name, 40)
	if _, err := validateStay(b.stay); err != nil {
		return result{}, err
	}
	if b.Name == "" || !phonePattern.MatchString(b.Phone) {
		return result{}, bad("请填写联系姓名和有效的中国大陆手机号")
	}
	var name, phone string
	if err := tx.QueryRow(ctx, "SELECT name,phone FROM contacts WHERE order_id=$1", o.ID).Scan(&name, &phone); err != nil {
		return result{}, err
	}
	if o.stay == b.stay && name == b.Name && phone == b.Phone {
		return result{ID: o.ID}, nil
	}

	reprice := o.Room != b.Room || o.Start != b.Start || o.End != b.End || o.Rooms != b.Rooms
	if reprice {
		if err := duplicateOrder(ctx, tx, a.ID, o.Hotel, b.stay, o.ID); err != nil {
			return result{}, err
		}
		prices, _, err := quoteStay(ctx, tx, o.Hotel, b.stay, o.ID, now)
		if err != nil {
			return result{}, err
		}
		if err := validateAcceptedQuote(b.Nights, prices); err != nil {
			return result{}, err
		}
		o.Nights = prices
	} else {
		r, err := readRoom(ctx, tx, o.Hotel, b.Room)
		if err != nil {
			return result{}, err
		}
		if b.People > r.Capacity*b.Rooms && b.People != o.People {
			return result{}, bad("入住人数超过该房型容量")
		}
	}
	o.Version++
	o.stay = b.stay
	if err := sqlExec(ctx, tx, `
		UPDATE orders SET room_id=$2,starts=$3::text::date,ends=$4::text::date,people=$5,quantity=$6,version=$7 WHERE id=$1`,
		o.ID, o.Room, o.Start, o.End, o.People, o.Rooms, o.Version); err != nil {
		return result{}, err
	}
	if err := saveVersion(ctx, tx, o, now); err != nil {
		return result{}, err
	}
	if err := saveContact(ctx, tx, o, b); err != nil {
		return result{}, err
	}
	if reprice {
		if err := sqlExec(ctx, tx, "UPDATE occupancy SET state='已释放' WHERE order_id=$1 AND state='承诺'", o.ID); err != nil {
			return result{}, err
		}
		if err := saveOccupancy(ctx, tx, o, promised); err != nil {
			return result{}, err
		}
	} else if err := sqlExec(ctx, tx, "UPDATE occupancy SET version=$2 WHERE order_id=$1 AND state='承诺'", o.ID, o.Version); err != nil {
		return result{}, err
	}
	if err := history(ctx, tx, now, o.ID, fmt.Sprintf("顾客改订完成，当前版本 %d", o.Version)); err != nil {
		return result{}, err
	}
	return result{ID: o.ID}, audit(ctx, tx, now, a, o.Hotel, "改订订单", o.ID, "订单版本已更新", "成功")
}

var successors = map[string][]string{
	pending:   {confirmed, cancelled, rejected, expired},
	confirmed: {staying, cancelled},
	staying:   {checkedOut},
}

func transition(ctx context.Context, tx pgx.Tx, a account, o order, target, note string, now time.Time) error {
	if !slices.Contains(successors[o.Status], target) {
		return conflict("order_state", "当前订单状态为"+o.Status+"，请查回最新状态")
	}
	var terminal, checkin, checkout *time.Time
	if !isActive(target) {
		terminal = &now
	}
	if target == staying {
		checkin = &now
	}
	if target == checkedOut {
		checkout = &now
	}
	if err := sqlExec(ctx, tx, `
		UPDATE orders SET status=$2,terminal_at=$3,checkin_at=COALESCE($4,checkin_at),checkout_at=$5 WHERE id=$1`,
		o.ID, target, terminal, checkin, checkout); err != nil {
		return err
	}
	var err error
	switch target {
	case checkedOut:
		releaseFrom := now.In(beijing)
		if releaseFrom.Hour() >= 12 {
			releaseFrom = releaseFrom.AddDate(0, 0, 1)
		}
		err = sqlExec(ctx, tx, `
			UPDATE occupancy SET state=CASE WHEN date >= $2::text::date THEN '已释放' ELSE '已消费' END
			WHERE order_id=$1 AND state='在住占用'`, o.ID, dateAt(releaseFrom))
	default:
		states := map[string]string{confirmed: promised, staying: inHouse, rejected: released, cancelled: released, expired: released}
		err = sqlExec(ctx, tx, "UPDATE occupancy SET state=$2 WHERE order_id=$1 AND state IN ('预占','承诺')", o.ID, states[target])
	}
	if err != nil {
		return err
	}
	if err := history(ctx, tx, now, o.ID, note); err != nil {
		return err
	}
	return audit(ctx, tx, now, a, o.Hotel, "订单状态变更", o.ID, o.Status+" → "+target, "成功")
}

func changeOrder(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	o, err := readOrder(ctx, tx, c.ID)
	if err != nil {
		return result{}, err
	}
	if !orderScope(a, o) {
		return result{}, missing()
	}
	note := cleanMultilineText(c.Note, 200)
	if c.Note != "" && note == "" {
		return result{}, bad("请检查处理原因长度和内容")
	}
	note = safeNote(note)
	if a.Role == customer {
		if o.Status == cancelled {
			return result{ID: o.ID}, nil
		}
		if o.Incident != "" {
			return result{}, conflict("incident", "订单正在由酒店处置履约异常")
		}
		if err := transition(ctx, tx, a, o, cancelled, "顾客主动取消 "+note, now); err != nil {
			return result{}, err
		}
		return result{ID: o.ID}, nil
	}
	target := c.Mode
	switch target {
	case confirmed, staying:
		if o.Incident != "" {
			return result{}, conflict("incident", "存在履约异常，请先从异常事件处置")
		}
		if target == staying {
			first, _ := parseDate(o.Start)
			last, _ := parseDate(o.End)
			if now.Before(first.Add(14*time.Hour)) || !now.Before(last.Add(12*time.Hour)) {
				return result{}, conflict("checkin_window", "入住办理时间为入住日十四点至离店日十二点前")
			}
		}
	case cancelled:
		last, _ := parseDate(o.End)
		if o.Status != confirmed || now.Before(last.Add(12*time.Hour)) || note == "" {
			return result{}, bad("仅可为已逾期未到店的已确认订单登记原因并取消")
		}
	case rejected:
		if note == "" {
			return result{}, bad("请登记拒绝原因")
		}
	case checkedOut:
	default:
		return result{}, bad("无法识别订单操作")
	}
	err = transition(ctx, tx, a, o, target, "酒店办理："+target+" "+note, now)
	return result{ID: o.ID}, err
}
