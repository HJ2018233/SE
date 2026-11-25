package main

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
)

func openIncident(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	i := c.Incident
	i.Title = cleanText(i.Title, 100)
	i.Reason = cleanMultilineText(i.Reason, 400)
	if i.Title == "" || i.Reason == "" {
		return result{}, bad("请填写事故标题和原因")
	}
	if _, err := stayDates(i.Start, i.End, 90); err != nil {
		return result{}, err
	}
	if i.Start < dateAt(now) {
		return result{}, bad("异常影响范围从今天或之后开始")
	}
	if i.Room != "" {
		if _, err := readRoom(ctx, tx, c.Hotel, i.Room); err != nil {
			return result{}, err
		}
	}
	i.ID = randomID("EV")
	if err := sqlExec(ctx, tx, `
		INSERT INTO incidents(id,hotel_id,room_id,starts,ends,title,reason,created_at)
		VALUES($1,$2,NULLIF($3,''),$4::text::date,$5::text::date,$6,$7,$8)`,
		i.ID, c.Hotel, i.Room, i.Start, i.End, safeNote(i.Title), safeNote(i.Reason), now); err != nil {
		return result{}, err
	}
	if err := sqlExec(ctx, tx, `
		UPDATE calendar c SET stopped=true,version=version+1 FROM rooms r
		WHERE c.room_id=r.id AND r.hotel_id=$1 AND ($2='' OR r.id=$2)
		  AND c.date >= $3::text::date AND c.date < $4::text::date AND NOT c.stopped`,
		c.Hotel, i.Room, i.Start, i.End); err != nil {
		return result{}, err
	}
	if err := sqlExec(ctx, tx, `
		INSERT INTO incident_orders(incident_id,order_id,progress,notes)
		SELECT $1,o.id,CASE WHEN o.status='已超时' THEN '已处理' ELSE '未处理' END,
			CASE WHEN o.status='已超时' THEN '确认时限已到，保留超时处理结果' ELSE '' END
		FROM orders o
		WHERE hotel_id=$2 AND ($3='' OR room_id=$3)
		  AND starts<$5::text::date AND ends>$4::text::date
		  AND status IN ('待确认','已确认','已入住','已超时')`,
		i.ID, c.Hotel, i.Room, i.Start, i.End); err != nil {
		return result{}, err
	}
	return result{ID: i.ID}, audit(ctx, tx, now, a, c.Hotel, "登记异常并停售", i.ID, "保存影响范围及订单清单", "成功")
}

func closeIncident(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	if c.Mode != "" && c.Mode != "resume" {
		return result{}, bad("无法识别异常关闭方式")
	}
	var roomID, start, end string
	var closed bool
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(room_id,''), starts::text, ends::text, closed
		FROM incidents WHERE id=$1`, c.ID).Scan(&roomID, &start, &end, &closed)
	if errors.Is(err, pgx.ErrNoRows) {
		return result{}, missing()
	}
	if err != nil {
		return result{}, err
	}
	if closed {
		return result{ID: c.ID}, nil
	}
	var pendingItems bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM incident_orders WHERE incident_id=$1 AND progress<>'已处理')",
		c.ID).Scan(&pendingItems); err != nil {
		return result{}, err
	}
	if pendingItems {
		return result{}, conflict("incident_pending", "还有关联订单等待处置")
	}
	tag, err := tx.Exec(ctx, "UPDATE incidents SET closed=true WHERE id=$1 AND NOT closed", c.ID)
	if err != nil || tag.RowsAffected() == 0 {
		return result{ID: c.ID}, err
	}
	detail := "全部关联订单已处理；停售标记保留"
	if c.Mode == "resume" {
		if err := sqlExec(ctx, tx, `
			UPDATE calendar c SET stopped=false, version=version+1
			FROM rooms r
			WHERE c.room_id=r.id AND r.hotel_id=$1 AND ($2='' OR r.id=$2)
			  AND c.date >= GREATEST($3::text::date, $5::text::date) AND c.date < $4::text::date
			  AND c.stopped
			  AND NOT EXISTS (
				SELECT 1 FROM incidents other
				WHERE other.hotel_id=$1 AND other.id<>$6 AND NOT other.closed
				  AND (other.room_id IS NULL OR other.room_id=r.id)
				  AND c.date >= other.starts AND c.date < other.ends
			  )`, c.Hotel, roomID, start, end, dateAt(now), c.ID); err != nil {
			return result{}, err
		}
		detail = "全部关联订单已处理；已解除影响范围停售标记"
	}
	return result{ID: c.ID}, audit(ctx, tx, now, a, c.Hotel, "完成异常处置", c.ID, detail, "成功")
}

func processIncident(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	var progress string
	var closed bool
	err := tx.QueryRow(ctx, `
		SELECT l.progress,i.closed FROM incident_orders l JOIN incidents i ON i.id=l.incident_id
		WHERE l.incident_id=$1 AND l.order_id=$2`, c.ID, c.Incident.ID).Scan(&progress, &closed)
	if errors.Is(err, pgx.ErrNoRows) {
		return result{}, missing()
	}
	if err != nil {
		return result{}, err
	}
	if closed || progress == "已处理" {
		return result{ID: c.ID}, nil
	}
	note := cleanMultilineText(c.Note, 400)
	if note == "" || (c.Mode != "contacting" && c.Mode != "complete" && c.Mode != "reached") {
		return result{}, bad("请填写联系或安置记录并选择处置结果")
	}
	o, err := readOrder(ctx, tx, c.Incident.ID)
	if err != nil {
		return result{}, err
	}
	next := "联系中"
	if c.Mode != "contacting" {
		next = "已处理"
		switch o.Status {
		case pending:
			err = transition(ctx, tx, a, o, rejected, "酒店因履约异常拒绝预订："+c.ID, now)
		case confirmed:
			if c.Mode != "reached" {
				return result{}, conflict("contact_required", "已确认订单须联系到顾客后才能按酒店原因取消")
			}
			err = transition(ctx, tx, a, o, cancelled, "酒店已联系顾客并按履约异常取消："+c.ID, now)
		case staying:
			err = history(ctx, tx, now, o.ID, "酒店已登记线下安置，实际退房后结转间夜："+c.ID)
		default:
			err = history(ctx, tx, now, o.ID, "保留原状态，关联酒店异常："+c.ID)
		}
		if err != nil {
			return result{}, err
		}
	}
	if err := sqlExec(ctx, tx, `
		UPDATE incident_orders SET progress=$3,notes=$4,contact_at=$5 WHERE incident_id=$1 AND order_id=$2`,
		c.ID, o.ID, next, safeNote(note), now); err != nil {
		return result{}, err
	}
	return result{ID: c.ID}, audit(ctx, tx, now, a, c.Hotel, "处置异常订单", o.ID, "关联异常 "+c.ID+"，进度 "+next, "成功")
}

func revealContact(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	o, err := readOrder(ctx, tx, c.ID)
	if err != nil {
		return result{}, err
	}
	if !a.mayManage(o.Hotel) {
		return result{}, missing()
	}
	if a.Role == admin || c.Incident.ID != "" {
		var linked bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM incident_orders WHERE incident_id=$1 AND order_id=$2)`,
			c.Incident.ID, c.ID).Scan(&linked); err != nil {
			return result{}, err
		}
		if !linked {
			return result{}, forbidden()
		}
	}
	purposes := map[string]string{
		"booking": "预订确认", "stay": "入住与退房", "incident": "履约异常调查",
	}
	purpose, known := purposes[c.Note]
	if !known || a.Role == admin && c.Note != "incident" {
		return result{}, bad("请选择符合当前权限的联系用途")
	}
	if !contactAllowed(o, now) {
		return result{}, conflict("privacy_expired", "联系方式的读取期限已到")
	}
	var name, phone string
	if err := tx.QueryRow(ctx, "SELECT name,phone FROM contacts WHERE order_id=$1", o.ID).Scan(&name, &phone); err != nil {
		return result{}, err
	}
	if phone == "" {
		return result{}, conflict("privacy_expired", "联系信息已清理")
	}
	return result{Name: name, Phone: phone}, audit(ctx, tx, now, a, o.Hotel, "查看完整联系方式", o.ID,
		"用途："+purpose+incidentReference(c.Incident.ID), "成功")
}

func (s *service) previewIncident(ctx context.Context, token string, filters url.Values) (out struct {
	Count int `json:"count"`
}, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		now := s.clock()
		a, err := actor(ctx, tx, token, now)
		if err != nil {
			return err
		}
		if a.Role != staff && a.Role != admin {
			return forbidden()
		}
		hotelID := filters.Get("hotel")
		if a.Role == staff {
			if hotelID == "" {
				hotelID = a.Hotel
			} else if hotelID != a.Hotel {
				return forbidden()
			}
		}
		if hotelID == "" {
			return bad("请选择酒店")
		}
		start, end := filters.Get("start"), filters.Get("end")
		if _, err := stayDates(start, end, 90); err != nil {
			return err
		}
		if start < dateAt(now) {
			return bad("异常影响范围从今天或之后开始")
		}
		if err := lockHotel(ctx, tx, hotelID); err != nil {
			return err
		}
		if err := expirePending(ctx, tx, hotelID, now); err != nil {
			return err
		}
		roomID := filters.Get("room")
		if roomID != "" {
			if _, err := readRoom(ctx, tx, hotelID, roomID); err != nil {
				return err
			}
		}
		return tx.QueryRow(ctx, `
			SELECT count(*) FROM orders
			WHERE hotel_id=$1 AND ($2='' OR room_id=$2)
			  AND starts<$4::text::date AND ends>$3::text::date
			  AND status IN ('待确认','已确认','已入住')`,
			hotelID, roomID, start, end).Scan(&out.Count)
	})
	return out, err
}

func incidentReference(id string) string {
	if id == "" {
		return ""
	}
	return "；关联 " + id
}
