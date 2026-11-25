package main

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func readHotel(ctx context.Context, tx pgx.Tx, id string) (hotel, error) {
	var h hotel
	err := tx.QueryRow(ctx, `
		SELECT id,name,city,address,phone,district,image,caption,description,enabled FROM hotels WHERE id=$1`, id).
		Scan(&h.ID, &h.Name, &h.City, &h.Address, &h.Phone, &h.District, &h.Image, &h.Caption, &h.Description, &h.Enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		err = missing()
	}
	return h, err
}

func readRoom(ctx context.Context, tx pgx.Tx, hotelID, id string) (room, error) {
	var r room
	err := tx.QueryRow(ctx, `
		SELECT id,hotel_id,name,capacity,size,bed,description,enabled FROM rooms WHERE hotel_id=$1 AND id=$2`, hotelID, id).
		Scan(&r.ID, &r.Hotel, &r.Name, &r.Capacity, &r.Size, &r.Bed, &r.Description, &r.Enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		err = missing()
	}
	return r, err
}

func incidentOverlap(ctx context.Context, tx pgx.Tx, hotelID, roomID, start, end string) (bool, error) {
	var blocked bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM incidents
		WHERE hotel_id=$1 AND (room_id IS NULL OR room_id=$2)
		  AND NOT closed AND starts<$4::text::date AND ends>$3::text::date)`,
		hotelID, roomID, start, end).Scan(&blocked)
	return blocked, err
}

func quoteStay(ctx context.Context, tx pgx.Tx, hotelID string, v stay, ownOrder string, now time.Time) ([]night, int, error) {
	dates, err := validateStay(v)
	if err != nil {
		return nil, 0, err
	}
	if err := validateSale(v, now); err != nil {
		return nil, 0, err
	}
	r, err := readRoom(ctx, tx, hotelID, v.Room)
	if err != nil {
		return nil, 0, err
	}
	h, err := readHotel(ctx, tx, hotelID)
	if err != nil {
		return nil, 0, err
	}
	if v.People > r.Capacity*v.Rooms {
		return nil, 0, bad("入住人数超过该房型容量")
	}
	if !r.Enabled || !h.Enabled {
		return nil, 0, conflict("unavailable", "酒店或房型已停售")
	}
	blocked, err := incidentOverlap(ctx, tx, hotelID, v.Room, v.Start, v.End)
	if err != nil {
		return nil, 0, err
	}
	if blocked {
		return nil, 0, conflict("unavailable", "住宿期间有履约异常，暂无法预订")
	}

	rows, err := tx.Query(ctx, `
		SELECT d.day,c.price,c.stopped,c.total-COALESCE((
			SELECT sum(o.quantity) FROM occupancy o
			WHERE o.room_id=c.room_id AND o.date=c.date AND o.state<>'已释放' AND o.order_id<>$3
		),0)
		FROM unnest($2::text[]) AS d(day)
		LEFT JOIN calendar c ON c.room_id=$1 AND c.date=d.day::date
		ORDER BY d.day`, v.Room, dates, ownOrder)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	nights := make([]night, 0, len(dates))
	available := maxRooms
	for rows.Next() {
		var item night
		var cents *int64
		var qty *int
		var stop *bool
		if err := rows.Scan(&item.Date, &cents, &stop, &qty); err != nil {
			return nil, 0, err
		}
		if qty == nil || *stop || *qty < v.Rooms {
			p := conflict("unavailable", "所选区间含不可订住宿日，请调整日期或房型")
			p.Date = item.Date
			return nil, 0, p
		}
		item.Price = *cents
		available = min(available, *qty)
		nights = append(nights, item)
	}
	return nights, available, rows.Err()
}

func updateCalendar(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	if _, err := readRoom(ctx, tx, c.Hotel, c.Room); err != nil {
		return result{}, err
	}
	if len(c.Calendar) < 1 || len(c.Calendar) > 90 {
		return result{}, bad("每次可维护 1 至 90 个住宿日")
	}
	seen := make(map[string]bool)
	for _, row := range c.Calendar {
		if _, err := parseDate(row.Date); err != nil {
			return result{}, err
		}
		if row.Date < dateAt(now) || seen[row.Date] || row.Total < 0 || row.Total > maxRooms ||
			row.Price <= 0 || row.Price > maxPrice || row.Version < 0 {
			return result{}, bad("请检查房量、价格、版本与日期，历史日期只读")
		}
		seen[row.Date] = true
		var version, occupied int
		err := tx.QueryRow(ctx, `
			SELECT COALESCE((SELECT version FROM calendar WHERE room_id=$1 AND date=$2::text::date),0),
			       COALESCE((SELECT sum(quantity) FROM occupancy
			                 WHERE room_id=$1 AND date=$2::text::date AND state<>'已释放'),0)`,
			c.Room, row.Date).Scan(&version, &occupied)
		if err != nil {
			return result{}, err
		}
		if row.Version != version || row.Total < occupied {
			p := conflict("calendar_conflict", "房量低于有效占用，或日期版本已变化，整批未保存")
			p.Date = row.Date
			return result{}, p
		}
	}
	for _, row := range c.Calendar {
		if err := sqlExec(ctx, tx, `
			INSERT INTO calendar(room_id,date,total,price,stopped,version) VALUES($1,$2::text::date,$3,$4,$5,1)
			ON CONFLICT (room_id,date) DO UPDATE SET total=EXCLUDED.total,price=EXCLUDED.price,
				stopped=EXCLUDED.stopped,version=calendar.version+1`,
			c.Room, row.Date, row.Total, row.Price, row.Stopped); err != nil {
			return result{}, err
		}
	}
	return result{ID: c.Room}, audit(ctx, tx, now, a, c.Hotel, "更新房量价格日历",
		c.Hotel+"/"+c.Room, fmt.Sprintf("修改 %d 个住宿日", len(c.Calendar)), "成功")
}

func saveHotel(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	h := c.Property
	h.Name = cleanText(h.Name, 80)
	h.City = cleanText(h.City, 40)
	h.District = cleanText(h.District, 40)
	h.Address = cleanText(h.Address, 160)
	h.Phone = cleanText(h.Phone, 32)
	if h.Name == "" || h.City == "" || h.Address == "" || h.Phone == "" {
		return result{}, bad("酒店名称、城市、地址、电话均为必填项")
	}
	h.Caption = cleanText(h.Caption, 80)
	if strings.TrimSpace(h.Description) != "" {
		h.Description = cleanMultilineText(h.Description, 600)
		if h.Description == "" {
			return result{}, bad("酒店简介不能超过 600 字且不能包含非法控制字符")
		}
	} else {
		h.Description = ""
	}
	if c.Hotel == "" {
		c.Hotel = randomID("H")
		cover := ""
		if presetPhotoURLs[h.Image] {
			cover = h.Image
		}
		if err := sqlExec(ctx, tx, `
			INSERT INTO hotels(id,name,city,district,address,phone,caption,description,image)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			c.Hotel, h.Name, h.City, h.District, h.Address, h.Phone, h.Caption, h.Description, cover); err != nil {
			return result{}, err
		}
		if cover != "" {
			capText := h.Caption
			if capText == "" {
				capText = h.Name
			}
			if err := sqlExec(ctx, tx, `
				INSERT INTO hotel_photos(id,hotel_id,sort_order,caption,content_type,data,source_url)
				VALUES($1,$2,0,$3,'',''::bytea,$4)`,
				randomID("P"), c.Hotel, capText, cover); err != nil {
				return result{}, err
			}
		}
		return result{ID: c.Hotel}, audit(ctx, tx, now, a, c.Hotel, "创建酒店", c.Hotel, "创建并启用酒店", "成功")
	}
	if err := sqlExec(ctx, tx, `
		UPDATE hotels SET name=$2,city=$3,district=$4,address=$5,phone=$6,caption=$7,description=$8 WHERE id=$1`,
		c.Hotel, h.Name, h.City, h.District, h.Address, h.Phone, h.Caption, h.Description); err != nil {
		return result{}, err
	}
	return result{ID: c.Hotel}, audit(ctx, tx, now, a, c.Hotel, "维护酒店资料", c.Hotel, "更新基本资料", "成功")
}

func saveRoom(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	r := c.RoomType
	r.Name = cleanText(r.Name, 80)
	if strings.TrimSpace(r.Description) != "" {
		r.Description = cleanMultilineText(r.Description, 400)
		if r.Description == "" {
			return result{}, bad("房型描述不能超过 400 字且不能包含非法控制字符")
		}
	} else {
		r.Description = ""
	}
	r.Bed = cleanText(r.Bed, 80)
	if r.Name == "" || r.Capacity < 1 || r.Capacity > 100 || r.Size < 0 || r.Size > 10000 {
		return result{}, bad("请填写房型名称、正整数入住人数和有效面积")
	}
	var err error
	if c.Room == "" {
		c.Room = randomID("R")
		err = sqlExec(ctx, tx, `
			INSERT INTO rooms(id,hotel_id,name,capacity,size,bed,description,enabled)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
			c.Room, c.Hotel, r.Name, r.Capacity, r.Size, r.Bed, r.Description, r.Enabled)
	} else {
		if _, err := readRoom(ctx, tx, c.Hotel, c.Room); err != nil {
			return result{}, err
		}
		err = sqlExec(ctx, tx, `
			UPDATE rooms SET name=$3,capacity=$4,size=$5,bed=$6,description=$7,enabled=$8
			WHERE id=$1 AND hotel_id=$2`,
			c.Room, c.Hotel, r.Name, r.Capacity, r.Size, r.Bed, r.Description, r.Enabled)
	}
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.ConstraintName == "active_room_name" {
		return result{}, conflict("duplicate_room", "酒店已有同名启用房型")
	}
	if err != nil {
		return result{}, err
	}
	return result{ID: c.Room}, audit(ctx, tx, now, a, c.Hotel, "维护房型", c.Hotel+"/"+c.Room, "保存房型资料", "成功")
}

func validateAcceptedQuote(accepted, actual []night) error {
	if slices.Equal(accepted, actual) {
		return nil
	}
	p := conflict("price_changed", "房价已变化，请核对并同意新报价")
	p.Nights = actual
	return p
}
