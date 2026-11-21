package main

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

type service struct {
	pool   *pgxpool.Pool
	secret []byte
	clock  func() time.Time
}

func randomID(prefix string) string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return prefix + hex.EncodeToString(b[:])
}

func (s *service) migrate(ctx context.Context) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(1687629329)"); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, schema)
		return err
	})
}

func lockHotel(ctx context.Context, tx pgx.Tx, id string) error {
	var locked string
	err := tx.QueryRow(ctx, "SELECT id FROM hotels WHERE id=$1 FOR UPDATE", id).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return missing()
	}
	return err
}

func lockHotels(ctx context.Context, tx pgx.Tx, id string) (err error) {
	rows, err := tx.Query(ctx, "SELECT id FROM hotels WHERE $1='' OR id=$1 ORDER BY id FOR UPDATE", id)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
	}
	return rows.Err()
}

func sqlExec(ctx context.Context, tx pgx.Tx, sql string, args ...any) error {
	_, err := tx.Exec(ctx, sql, args...)
	return err
}

func audit(ctx context.Context, tx pgx.Tx, now time.Time, a account, hotelID, action, object, detail, outcome string) error {
	return sqlExec(ctx, tx, `
		INSERT INTO audit(happened_at,actor_id,role,hotel_id,action,object,detail,result)
		VALUES($1,NULLIF($2,''),$3,NULLIF($4,''),$5,$6,$7,$8)`,
		now, a.ID, a.Role, hotelID, action, object, detail, outcome)
}

func history(ctx context.Context, tx pgx.Tx, now time.Time, orderID, message string) error {
	return sqlExec(ctx, tx, "INSERT INTO order_history(order_id,happened_at,message) VALUES($1,$2,$3)",
		orderID, now, message)
}

func expirePending(ctx context.Context, tx pgx.Tx, hotelID string, now time.Time) error {
	// The caller holds the hotel lock. Keep the original deadline when a timer runs late.
	return sqlExec(ctx, tx, `
		WITH changed AS (
			UPDATE orders SET status='已超时',terminal_at=deadline
			WHERE ($1='' OR hotel_id=$1) AND status='待确认' AND deadline <= $2
			RETURNING id,hotel_id,deadline
		), released AS (
			UPDATE occupancy SET state='已释放'
			WHERE order_id IN (SELECT id FROM changed) AND state='预占'
		), recorded AS (
			INSERT INTO order_history(order_id,happened_at,message)
			SELECT id,deadline,'确认期限已到，预占已释放' FROM changed
		)
		INSERT INTO audit(happened_at,role,hotel_id,action,object,detail,result)
		SELECT deadline,'system',hotel_id,'订单超时',id,'确认期限已到，释放全部预占','成功' FROM changed`,
		hotelID, now)
}

func purgeContacts(ctx context.Context, tx pgx.Tx, now time.Time) error {
	return sqlExec(ctx, tx, `
		UPDATE contacts c SET name='',phone=''
		FROM orders o WHERE c.order_id=o.id AND (c.phone<>'' OR c.name<>'') AND o.terminal_at <= $1`,
		now.Add(-7*24*time.Hour))
}

func (s *service) maintain(ctx context.Context) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockHotels(ctx, tx, ""); err != nil {
			return err
		}
		now := s.clock()
		if err := expirePending(ctx, tx, "", now); err != nil {
			return err
		}
		if err := purgeContacts(ctx, tx, now); err != nil {
			return err
		}
		return sqlExec(ctx, tx, "DELETE FROM sessions WHERE expires_at <= $1", now)
	})
}

func (s *service) verifyStore(ctx context.Context) error {
	var invalid bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM calendar c JOIN occupancy x ON (c.room_id,c.date)=(x.room_id,x.date)
			WHERE x.state<>'已释放' GROUP BY c.room_id,c.date,c.total HAVING sum(x.quantity)>c.total
		) OR EXISTS (
			SELECT 1 FROM orders o
			LEFT JOIN order_versions v ON (v.order_id,v.version)=(o.id,o.version)
			WHERE v.order_id IS NULL OR
				(v.room_id,v.starts,v.ends,v.people,v.quantity) <>
				(o.room_id,o.starts,o.ends,o.people,o.quantity) OR
				NOT EXISTS (SELECT 1 FROM audit a WHERE a.object=o.id AND a.action='提交预订' AND a.result='成功') OR
				NOT EXISTS (SELECT 1 FROM contacts c WHERE c.order_id=o.id) OR
				EXISTS (
					SELECT 1 FROM generate_series(o.starts::timestamp,(o.ends-1)::timestamp,interval '1 day') d
					LEFT JOIN occupancy x ON x.date=d::date AND x.order_id=o.id
					WHERE x.order_id IS NULL OR (x.room_id,x.version,x.quantity)<>(o.room_id,o.version,o.quantity)
				)
		)`).Scan(&invalid)
	if err != nil {
		return err
	}
	if invalid {
		return fmt.Errorf("database integrity check failed for orders or occupancy")
	}
	return nil
}
