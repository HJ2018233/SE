package main

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const passwordRounds = 600_000

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Label    string `json:"label"`
	Hotel    string `json:"hotel,omitempty"`
}

type signInResult struct {
	Account account `json:"account"`
	Token   string  `json:"token"`
}

func username(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func passwordHash(password string) (string, error) {
	var salt [16]byte
	_, _ = rand.Read(salt[:])
	key, err := pbkdf2.Key(sha256.New, password, salt[:], passwordRounds, 32)
	if err != nil {
		return "", err
	}
	encoding := base64.RawStdEncoding
	return encoding.EncodeToString(salt[:]) + "." + encoding.EncodeToString(key), nil
}

func passwordMatches(password, stored string) bool {
	saltString, hashString, ok := strings.Cut(stored, ".")
	salt, saltErr := base64.RawStdEncoding.DecodeString(saltString)
	digest, hashErr := base64.RawStdEncoding.DecodeString(hashString)
	if !ok || saltErr != nil || hashErr != nil || len(salt) != 16 || len(digest) != 32 {
		return false
	}
	actual, err := pbkdf2.Key(sha256.New, password, salt, passwordRounds, 32)
	return err == nil && subtle.ConstantTimeCompare(actual, digest) == 1
}

func insertAccount(ctx context.Context, tx pgx.Tx, login credentials, role string) (account, error) {
	login.Username = username(login.Username)
	login.Label = cleanText(login.Label, 64)
	if login.Label == "" {
		login.Label = login.Username
	}
	a := account{ID: randomID("U"), Username: login.Username, Label: login.Label, Role: role, Hotel: login.Hotel, Enabled: true}
	if !userPattern.MatchString(a.Username) || len(login.Password) < 10 || len(login.Password) > 256 {
		return a, bad("账号须为 3 至 64 位小写字母、数字或 ._-，密码须为 10 至 256 字节")
	}
	hash, err := passwordHash(login.Password)
	if err != nil {
		return a, err
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO accounts(id,username,label,role,hotel_id,password)
		VALUES($1,$2,$3,$4,NULLIF($5,''),$6) ON CONFLICT (username) DO NOTHING`,
		a.ID, a.Username, a.Label, a.Role, a.Hotel, hash)
	if err == nil && tag.RowsAffected() == 0 {
		err = conflict("username_taken", "该账号名称已被使用")
	}
	return a, err
}

func startSession(ctx context.Context, tx pgx.Tx, a account, now time.Time) (signInResult, error) {
	token := randomID("") + randomID("")
	digest := sha256.Sum256([]byte(token))
	err := sqlExec(ctx, tx, "INSERT INTO sessions(digest,account_id,expires_at) VALUES($1,$2,$3)",
		digest[:], a.ID, now.Add(12*time.Hour))
	return signInResult{Account: a, Token: token}, err
}

func (s *service) signIn(ctx context.Context, login credentials, register bool) (res signInResult, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var a account
		var hashed string
		if register {
			login.Hotel = ""
			a, err = insertAccount(ctx, tx, login, customer)
		} else {
			if len(login.Password) > 256 || !userPattern.MatchString(username(login.Username)) {
				return unauthenticated()
			}
			err = tx.QueryRow(ctx, `
				SELECT id,username,label,role,COALESCE(hotel_id,''),enabled,password
				FROM accounts WHERE username=$1 FOR SHARE`, username(login.Username)).
				Scan(&a.ID, &a.Username, &a.Label, &a.Role, &a.Hotel, &a.Enabled, &hashed)
			if errors.Is(err, pgx.ErrNoRows) {
				hashed = "aaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
			} else if err != nil {
				return err
			}
			if !passwordMatches(login.Password, hashed) || !a.Enabled {
				return &problem{Status: 401, Code: "login", Text: "账号或密码错误，或账号已停用"}
			}
		}
		if err != nil {
			return err
		}
		res, err = startSession(ctx, tx, a, s.clock())
		return err
	})
	return res, err
}

func actor(ctx context.Context, tx pgx.Tx, token string, now time.Time) (a account, err error) {
	if len(token) != 64 {
		return a, unauthenticated()
	}
	digest := sha256.Sum256([]byte(token))
	err = tx.QueryRow(ctx, `
		SELECT a.id,a.username,a.label,a.role,COALESCE(a.hotel_id,''),a.enabled
		FROM sessions s JOIN accounts a ON a.id=s.account_id
		WHERE s.digest=$1 AND s.expires_at>$2 AND a.enabled
		FOR SHARE OF a`, digest[:], now).Scan(&a.ID, &a.Username, &a.Label, &a.Role, &a.Hotel, &a.Enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		err = unauthenticated()
	}
	return a, err
}

func (s *service) logout(ctx context.Context, token string) error {
	digest := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(ctx, "DELETE FROM sessions WHERE digest=$1", digest[:])
	return err
}

func (s *service) bootstrapAdmin(ctx context.Context, login credentials) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := sqlExec(ctx, tx, "SELECT pg_advisory_xact_lock(1687629329)"); err != nil {
			return err
		}
		var found bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM accounts WHERE role='admin')").Scan(&found); err != nil {
			return err
		}
		if found {
			return fmt.Errorf("administrator already initialized")
		}
		login.Hotel = ""
		a, err := insertAccount(ctx, tx, login, admin)
		if err != nil {
			return err
		}
		return audit(ctx, tx, s.clock(), a, "", "初始化管理员", a.ID, "部署初始化", "成功")
	})
}

func setStaffEnabled(ctx context.Context, tx pgx.Tx, a account, now time.Time, id string, enabled bool) (result, error) {
	if a.Role != admin {
		return result{}, forbidden()
	}
	var hotelID string
	err := tx.QueryRow(ctx, `
		UPDATE accounts SET enabled=$2 WHERE id=$1 AND role='staff' RETURNING hotel_id`,
		id, enabled).Scan(&hotelID)
	if errors.Is(err, pgx.ErrNoRows) {
		return result{}, missing()
	}
	if err != nil {
		return result{}, err
	}
	if !enabled {
		if err := sqlExec(ctx, tx, "DELETE FROM sessions WHERE account_id=$1", id); err != nil {
			return result{}, err
		}
	}
	return result{ID: id}, audit(ctx, tx, now, a, hotelID, "调整工作人员账户", id,
		fmt.Sprintf("启用状态：%t", enabled), "成功")
}
