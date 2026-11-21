package main

import (
	"context"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
)

type statisticNight struct {
	Order     string `json:"order"`
	Date      string `json:"date"`
	Room      string `json:"room"`
	Rooms     int    `json:"rooms"`
	Status    string `json:"status"`
	State     string `json:"state"`
	Price     int64  `json:"price"`
	Effective int64  `json:"effective"`
}

type statisticCalendar struct {
	Date string `json:"date"`
	Room string `json:"room"`
	calendarEntry
	Remaining int `json:"remaining"`
	Available int `json:"available"`
}

type statistics struct {
	At           string              `json:"at"`
	Start        string              `json:"start"`
	End          string              `json:"end"`
	Room         string              `json:"room"`
	Total        int                 `json:"total"`
	Remaining    int                 `json:"remaining"`
	Available    int                 `json:"available"`
	Held         int                 `json:"held"`
	Committed    int                 `json:"committed"`
	Staying      int                 `json:"staying"`
	Consumed     int                 `json:"consumed"`
	Amount       int64               `json:"amount"`
	CalendarRows []statisticCalendar `json:"calendarRows"`
	Rows         []statisticNight    `json:"rows"`
}

func collectStats(ctx context.Context, tx pgx.Tx, hotel string, now time.Time, out *statistics) error {
	rows, err := tx.Query(ctx, `
		SELECT o.id,x.date::text,x.room_id,x.quantity,o.status,x.state,x.price,
			CASE WHEN x.state IN ('承诺','在住占用','已消费') THEN x.quantity*x.price ELSE 0 END
		FROM occupancy x JOIN orders o ON o.id=x.order_id
		WHERE o.hotel_id=$1 AND ($2='all' OR x.room_id=$2) AND x.date >= $3::text::date AND x.date < $4::text::date
		ORDER BY x.date,x.room_id,o.id`, hotel, out.Room, out.Start, out.End)
	if err != nil {
		return err
	}
	out.Rows, err = pgx.CollectRows(rows, pgx.RowToStructByPos[statisticNight])
	out.Rows = listOrEmpty(out.Rows)
	if err != nil {
		return err
	}
	occupied := make(map[[2]string]int)
	for _, row := range out.Rows {
		if row.State != released {
			occupied[[2]string{row.Room, row.Date}] += row.Rooms
		}
		switch row.State {
		case held:
			out.Held += row.Rooms
		case promised:
			out.Committed += row.Rooms
		case inHouse:
			out.Staying += row.Rooms
		case consumed:
			out.Consumed += row.Rooms
		}
		out.Amount += row.Effective
	}

	rows, err = tx.Query(ctx, `
		SELECT c.date::text,r.id,c.total,c.price,c.version,
		       c.stopped OR NOT (h.enabled AND r.enabled) OR EXISTS (
		           SELECT 1 FROM incidents i WHERE i.hotel_id=h.id AND (i.room_id IS NULL OR i.room_id=r.id)
		             AND NOT i.closed AND c.date>=i.starts AND c.date<i.ends)
		FROM calendar c JOIN rooms r ON r.id=c.room_id JOIN hotels h ON h.id=r.hotel_id
		WHERE r.hotel_id=$1 AND ($2='all' OR r.id=$2) AND c.date >= $3::text::date AND c.date < $4::text::date
		ORDER BY c.date,r.id`, hotel, out.Room, out.Start, out.End)
	if err != nil {
		return err
	}
	defer rows.Close()
	out.CalendarRows = make([]statisticCalendar, 0)
	for rows.Next() {
		var row statisticCalendar
		if err := rows.Scan(&row.Date, &row.Room, &row.Total, &row.Price, &row.Version, &row.Stopped); err != nil {
			return err
		}
		row.Occupied = occupied[[2]string{row.Room, row.Date}]
		row.Remaining = row.Total - row.Occupied
		if !row.Stopped && (row.Date > dateAt(now) || row.Date == dateAt(now) && now.In(beijing).Hour() < 18) {
			row.Available = row.Remaining
		}
		out.Total += row.Total
		out.Remaining += row.Remaining
		out.Available += row.Available
		out.CalendarRows = append(out.CalendarRows, row)
	}
	return rows.Err()
}

func (s *service) stats(ctx context.Context, token string, filters url.Values) (out statistics, err error) {
	out = statistics{Start: filters.Get("start"), End: filters.Get("end"), Room: filters.Get("room")}
	if _, err := stayDates(out.Start, out.End, 90); err != nil {
		return out, err
	}
	if out.Room == "" {
		out.Room = "all"
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		a, err := actor(ctx, tx, token, s.clock())
		if err != nil {
			return err
		}
		if a.Role != staff {
			return forbidden()
		}
		if err := lockHotel(ctx, tx, a.Hotel); err != nil {
			return err
		}
		now := s.clock()
		if err := expirePending(ctx, tx, a.Hotel, now); err != nil {
			return err
		}
		if out.Room != "all" {
			if _, err := readRoom(ctx, tx, a.Hotel, out.Room); err != nil {
				return err
			}
		}
		out.At = eventTime(now)
		return collectStats(ctx, tx, a.Hotel, now, &out)
	})
	return out, err
}
