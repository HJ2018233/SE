package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func run() error {
	address := flag.String("listen", "127.0.0.1:8080", "HTTP listen address (loopback unless TLS is enabled)")
	static := flag.String("static", "", "optional built frontend directory")
	seed := flag.Bool("seed", false, "add sample hotel catalog before startup")
	initialize := flag.Bool("init-admin", false, "create the first admin and exit")
	check := flag.Bool("check", false, "expire temporary data, verify storage integrity and exit")
	flag.Parse()
	dsn := os.Getenv("HOTEL_DATABASE_URL")
	secret := os.Getenv("HOTEL_OPERATION_SECRET")
	if dsn == "" || len(secret) < 32 {
		return fmt.Errorf("set HOTEL_DATABASE_URL and a stable HOTEL_OPERATION_SECRET of at least 32 bytes")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("parse HOTEL_DATABASE_URL: %s", "check the connection format")
	}
	cfg.MaxConns = 16
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()
	s := &service{pool: pool, secret: []byte(secret), clock: time.Now}
	ready, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	if err := s.migrate(ready); err != nil {
		return fmt.Errorf("initialize schema: %w", err)
	}
	if *initialize {
		return s.bootstrapAdmin(ready, credentials{Username: os.Getenv("HOTEL_ADMIN_USER"), Password: os.Getenv("HOTEL_ADMIN_PASSWORD"), Label: "平台管理员"})
	}
	if *seed {
		if err := s.seed(ready); err != nil {
			return fmt.Errorf("initialize sample hotels: %w", err)
		}
	}
	if err := s.maintain(ready); err != nil {
		return fmt.Errorf("process expired records: %w", err)
	}
	if err := s.verifyStore(ready); err != nil {
		return err
	}
	if *check {
		return nil
	}
	cert, key := os.Getenv("HOTEL_TLS_CERT"), os.Getenv("HOTEL_TLS_KEY")
	if (cert == "") != (key == "") {
		return errors.New("configure both HOTEL_TLS_CERT and HOTEL_TLS_KEY")
	}
	host, _, err := net.SplitHostPort(*address)
	if err != nil {
		return err
	}
	if cert == "" && host != "localhost" && !net.ParseIP(host).IsLoopback() {
		return errors.New("non-loopback addresses require HTTPS")
	}
	origins := originList(os.Getenv("HOTEL_ALLOWED_ORIGINS"))
	server := &http.Server{
		Addr: *address, Handler: s.routes(*static, origins),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
	}
	listen := make(chan error, 1)
	go func() {
		if cert != "" {
			listen <- server.ListenAndServeTLS(cert, key)
		} else {
			listen <- server.ListenAndServe()
		}
	}()
	go s.runMaintenance(ctx)
	slog.Info("hotel booking service starting", "address", *address, "tls", cert != "")
	select {
	case err := <-listen:
		if cleanServerError(err) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}

func (s *service) runMaintenance(ctx context.Context) {
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			work, cancel := context.WithTimeout(ctx, 25*time.Second)
			err := s.maintain(work)
			cancel()
			if err != nil && ctx.Err() == nil {
				slog.Error("background maintenance failed", "error_type", fmt.Sprintf("%T", err))
			}
		}
	}
}

func main() {
	if err := run(); err != nil {
		slog.Error("service stopped", "error", err)
		os.Exit(1)
	}
}
