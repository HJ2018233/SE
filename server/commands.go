package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var orderWrites = map[string]bool{
	"book": true, "revise": true, "cancel": true, "transition": true,
}

func authorizedCommand(a account, c command) bool {
	switch c.Action {
	case "book", "revise", "cancel":
		return a.Role == customer
	case "transition", "calendar", "room", "photo_add_preset", "photo_reorder", "photo_caption", "photo_delete":
		return a.Role == staff
	case "hotel":
		return c.Hotel == "" && a.Role == admin || c.Hotel != "" && a.Role == staff
	case "hotel_enabled", "staff_create", "staff_enabled":
		return a.Role == admin
	case "incident_open", "incident_update", "incident_close", "contact", "stats_export":
		return a.Role == staff || a.Role == admin
	}
	return false
}

func commandHotel(ctx context.Context, tx pgx.Tx, a account, c command) (string, error) {
	switch c.Action {
	case "revise", "cancel", "transition", "contact":
		var h string
		err := tx.QueryRow(ctx, `
			SELECT hotel_id FROM orders
			WHERE id=$1 AND ($2<>'customer' OR customer_id=$3) AND ($2<>'staff' OR hotel_id=$4)`,
			c.ID, a.Role, a.ID, a.Hotel).Scan(&h)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", missing()
		}
		return h, err
	case "incident_update", "incident_close":
		var h string
		err := tx.QueryRow(ctx, `
			SELECT hotel_id FROM incidents WHERE id=$1 AND ($2='admin' OR hotel_id=$3)`,
			c.ID, a.Role, a.Hotel).Scan(&h)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", missing()
		}
		return h, err
	case "staff_create":
		if c.User.Hotel == "" {
			return "", bad("请选择工作人员所属酒店")
		}
		return c.User.Hotel, nil
	case "staff_enabled":
		return "", nil
	default:
		if c.Hotel == "" && (c.Action != "hotel" || a.Role != admin) {
			return "", bad("请选择酒店")
		}
		if a.Role == staff && a.Hotel != c.Hotel {
			return "", forbidden()
		}
		return c.Hotel, nil
	}
}

func (s *service) execute(ctx context.Context, token string, c command) (res result, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		a, err := actor(ctx, tx, token, s.clock())
		if err != nil {
			return err
		}
		if !authorizedCommand(a, c) {
			return forbidden()
		}
		if !orderWrites[c.Action] {
			res, err = s.executeAuthorized(ctx, tx, a, c)
			return err
		}
		if !keyPattern.MatchString(c.Key) {
			return bad("操作标识格式不正确")
		}
		key := c.Key
		c.Key = ""
		c.Booking.Name = cleanText(c.Booking.Name, 40)
		c.Note = cleanText(c.Note, 200)
		encoded, err := json.Marshal(c)
		if err != nil {
			return err
		}
		digest := hmac.New(sha256.New, s.secret)
		_, _ = digest.Write(encoded)
		fingerprint := digest.Sum(nil)
		if err := sqlExec(ctx, tx, `
			INSERT INTO operations(actor_id,operation_key,fingerprint)
			VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, a.ID, key, fingerprint); err != nil {
			return err
		}
		var saved []byte
		var recorded *result
		if err := tx.QueryRow(ctx, `
			SELECT fingerprint,result FROM operations WHERE actor_id=$1 AND operation_key=$2 FOR UPDATE`,
			a.ID, key).Scan(&saved, &recorded); err != nil {
			return err
		}
		if !hmac.Equal(fingerprint, saved) {
			return conflict("key_reused", "同一操作标识已用于不同的输入")
		}

		c.Hotel, err = commandHotel(ctx, tx, a, c)
		if err != nil {
			return err
		}
		if err := lockHotel(ctx, tx, c.Hotel); err != nil {
			return err
		}
		now := s.clock()
		if err := expirePending(ctx, tx, c.Hotel, now); err != nil {
			return err
		}
		if recorded == nil {
			// Preserve expiry processing if this attempt is rejected by a business rule.
			err = pgx.BeginFunc(ctx, tx, func(business pgx.Tx) error {
				res, err = dispatch(ctx, business, a, now, c)
				return err
			})
			if err != nil {
				p := asProblem(err)
				if p == nil {
					return err
				}
				res = result{Problem: p}
				if err := audit(ctx, tx, now, a, c.Hotel, "订单操作未执行", c.ID, c.Action+" / "+p.Code, "拒绝"); err != nil {
					return err
				}
			}
			if err := sqlExec(ctx, tx, `
				UPDATE operations SET result=$3 WHERE actor_id=$1 AND operation_key=$2`, a.ID, key, res); err != nil {
				return err
			}
		} else {
			res = *recorded
		}
		return attachOrder(ctx, tx, a, &res)
	})
	if err == nil && res.Problem != nil {
		err = res.Problem
	}
	return res, err
}

func attachOrder(ctx context.Context, tx pgx.Tx, a account, res *result) error {
	if res.ID == "" {
		return nil
	}
	o, err := readOrder(ctx, tx, res.ID)
	if err != nil {
		return err
	}
	if !orderScope(a, o) {
		return missing()
	}
	res.Order = &o
	return nil
}

func (s *service) executeAuthorized(ctx context.Context, tx pgx.Tx, a account, c command) (result, error) {
	var err error
	c.Hotel, err = commandHotel(ctx, tx, a, c)
	if err != nil {
		return result{}, err
	}
	if c.Hotel != "" {
		if err := lockHotel(ctx, tx, c.Hotel); err != nil {
			return result{}, err
		}
	}
	now := s.clock()
	if c.Hotel != "" {
		if err := expirePending(ctx, tx, c.Hotel, now); err != nil {
			return result{}, err
		}
	}
	return dispatch(ctx, tx, a, now, c)
}

func dispatch(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	switch c.Action {
	case "book":
		return createBooking(ctx, tx, a, now, c)
	case "revise":
		return reviseBooking(ctx, tx, a, now, c)
	case "cancel", "transition":
		return changeOrder(ctx, tx, a, now, c)
	case "calendar":
		return updateCalendar(ctx, tx, a, now, c)
	case "hotel":
		return saveHotel(ctx, tx, a, now, c)
	case "room":
		return saveRoom(ctx, tx, a, now, c)
	case "photo_add_preset":
		return addPresetPhoto(ctx, tx, a, now, c)
	case "photo_reorder":
		return reorderPhotos(ctx, tx, a, now, c)
	case "photo_caption":
		return updatePhotoCaption(ctx, tx, a, now, c)
	case "photo_delete":
		return deletePhoto(ctx, tx, a, now, c)
	case "hotel_enabled":
		if err := sqlExec(ctx, tx, "UPDATE hotels SET enabled=$2 WHERE id=$1", c.Hotel, c.Enabled); err != nil {
			return result{}, err
		}
		detail := "停用酒店"
		if c.Enabled {
			detail = "启用酒店"
		}
		return result{ID: c.Hotel}, audit(ctx, tx, now, a, c.Hotel, "调整酒店营业状态", c.Hotel, detail, "成功")
	case "staff_create":
		account, err := insertAccount(ctx, tx, c.User, staff)
		if err != nil {
			return result{}, err
		}
		return result{ID: account.ID}, audit(ctx, tx, now, a, c.Hotel, "分配工作人员权限", account.ID, "绑定单一所属酒店", "成功")
	case "staff_enabled":
		return setStaffEnabled(ctx, tx, a, now, c.ID, c.Enabled)
	case "incident_open":
		return openIncident(ctx, tx, a, now, c)
	case "incident_update":
		return processIncident(ctx, tx, a, now, c)
	case "incident_close":
		return closeIncident(ctx, tx, a, now, c)
	case "contact":
		return revealContact(ctx, tx, a, now, c)
	case "stats_export":
		if a.Role != staff {
			return result{}, forbidden()
		}
		return result{}, audit(ctx, tx, now, a, c.Hotel, "导出间夜统计", c.Hotel, "导出同一统计快照，不含联系资料", "成功")
	}
	return result{}, bad("未知操作")
}

func (s *service) operation(ctx context.Context, token, key string) (res result, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		a, err := actor(ctx, tx, token, s.clock())
		if err != nil {
			return err
		}
		var saved *result
		err = tx.QueryRow(ctx, "SELECT result FROM operations WHERE actor_id=$1 AND operation_key=$2", a.ID, key).Scan(&saved)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && saved == nil {
			return missing()
		}
		if err != nil {
			return err
		}
		res = *saved
		if res.ID == "" {
			return nil
		}
		hotelID, err := commandHotel(ctx, tx, a, command{Action: "revise", ID: res.ID})
		if err != nil {
			return err
		}
		if err := lockHotel(ctx, tx, hotelID); err != nil {
			return err
		}
		if err := expirePending(ctx, tx, hotelID, s.clock()); err != nil {
			return err
		}
		return attachOrder(ctx, tx, a, &res)
	})
	return res, err
}
