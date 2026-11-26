package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func postgresTestService(t *testing.T) (*service, func(time.Time)) {
	t.Helper()
	dsn := os.Getenv("HOTEL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("HOTEL_TEST_DATABASE_URL is required for PostgreSQL integration tests")
	}
	ctx := context.Background()
	base, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(base.Close)
	namespace := "hotel_it_" + randomID("")
	if _, err := base.Exec(ctx, "CREATE SCHEMA "+namespace); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := base.Exec(context.Background(), "DROP SCHEMA "+namespace+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = namespace
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var seconds atomic.Int64
	setClock := func(t time.Time) { seconds.Store(t.Unix()) }
	setClock(time.Date(2027, 3, 1, 12, 0, 0, 0, beijing))
	s := &service{
		pool: pool, secret: []byte("isolated integration test operation key"),
		clock: func() time.Time { return time.Unix(seconds.Load(), 0) },
	}
	if err := s.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.seed(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.bootstrapAdmin(ctx, credentials{Username: "admin", Password: "isolated-test-admin"}); err != nil {
		t.Fatal(err)
	}
	return s, setClock
}

func callAPI(handler http.Handler, method, path, token string, payload any) *httptest.ResponseRecorder {
	var body io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			panic(err)
		}
		body = bytes.NewReader(b)
	}
	r := httptest.NewRequest(method, path, body)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func expectAPI[T any](t *testing.T, w *httptest.ResponseRecorder, status int) T {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status = %d, want %d. body = %s", w.Code, status, w.Body.String())
	}
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestPostgresBookingLifecycle(t *testing.T) {
	s, setClock := postgresTestService(t)
	ctx := context.Background()
	handler := s.routes(t.TempDir(), nil)
	login := func(path, username, password string) string {
		t.Helper()
		return expectAPI[signInResult](t, callAPI(handler, "POST", path, "", credentials{
			Username: username, Password: password,
		}), 200).Token
	}
	adminToken := login("/api/login", "admin", "isolated-test-admin")
	cust := login("/api/register", "guest-a", "isolated-test-user")
	other := login("/api/register", "guest-b", "isolated-test-user")
	do := func(token string, c command) *httptest.ResponseRecorder {
		return callAPI(handler, "POST", "/api/commands", token, c)
	}
	createStaff := func(name, hotel string) (string, string) {
		t.Helper()
		created := expectAPI[result](t, do(adminToken, command{Action: "staff_create",
			User: credentials{Username: name, Password: "isolated-test-staff", Hotel: hotel}}), 200)
		return login("/api/login", name, "isolated-test-staff"), created.ID
	}
	front, staffID := createStaff("desk-qt", "qt")
	foreign, _ := createStaff("desk-xw", "xw")
	expectAPI[problem](t, do(cust, command{Action: "hotel_enabled", Hotel: "qt"}), 403)
	expectAPI[problem](t, do(foreign, command{Action: "calendar", Hotel: "qt", Room: "qt-garden"}), 403)

	view := expectAPI[snapshot](t, callAPI(handler, "GET", "/api/state", "", nil), 200)
	if view.Orders == nil || view.Incidents == nil || len(view.Rooms) == 0 {
		t.Fatal("empty projections must have array representations")
	}
	price := func(date string) int64 { return view.Calendar["qt/qt-garden/"+date].Price }
	var calendar []calendarChange
	for _, date := range []string{"2027-03-02", "2027-03-03", "2027-03-04"} {
		calendar = append(calendar, calendarChange{Date: date,
			calendarEntry: calendarEntry{Total: 1, Price: price(date), Version: 1}})
	}
	expectAPI[result](t, do(front, command{Action: "calendar", Hotel: "qt", Room: "qt-garden", Calendar: calendar}), 200)
	expectAPI[problem](t, do(front, command{Action: "calendar", Hotel: "qt", Room: "qt-garden", Calendar: calendar}), 409)

	b := booking{
		stay: stay{Room: "qt-garden", Start: "2027-03-02", End: "2027-03-04", People: 2, Rooms: 1},
		Name: "测试顾客", Phone: "13800009999",
		Nights: []night{{"2027-03-02", price("2027-03-02")}, {"2027-03-03", price("2027-03-03")}},
	}
	place := func(key string) command { return command{Action: "book", Key: key, Hotel: "qt", Booking: b} }
	stale := place("stale-quote-test")
	stale.Booking.Nights = []night{{"2027-03-02", 100}, {"2027-03-03", 100}}
	if p := expectAPI[problem](t, do(cust, stale), 409); p.Code != "price_changed" || len(p.Nights) != 2 {
		t.Fatalf("expected a fresh quote, got %+v", p)
	}

	var winningToken, orderID, winningKey string
	for i := range 100 {
		keys := []string{fmt.Sprintf("last-room-customer-a-%03d", i), fmt.Sprintf("last-room-customer-b-%03d", i)}
		tokens := []string{cust, other}
		replies := make([]*httptest.ResponseRecorder, 2)
		var workers sync.WaitGroup
		for j := range 2 {
			workers.Go(func() { replies[j] = do(tokens[j], place(keys[j])) })
		}
		workers.Wait()
		winner := -1
		for j, reply := range replies {
			if reply.Code == 200 {
				if winner != -1 {
					t.Fatalf("round %d: both last-room bookings succeeded", i)
				}
				winner = j
			} else {
				if p := expectAPI[problem](t, reply, 409); p.Code != "unavailable" {
					t.Fatalf("round %d: unexpected loser result %+v", i, p)
				}
			}
		}
		if winner == -1 {
			t.Fatalf("round %d: neither last-room booking succeeded", i)
		}
		placed := expectAPI[result](t, replies[winner], 200)
		orderID, winningToken, winningKey = placed.ID, tokens[winner], keys[winner]
		if len(placed.Order.Occupancy) != 2 {
			t.Fatalf("round %d: partial release or booking", i)
		}
		if i != 99 {
			expectAPI[result](t, do(winningToken, command{Action: "cancel", ID: orderID,
				Key: fmt.Sprintf("cancel-last-room-%03d", i)}), 200)
		}
	}
	var retries sync.WaitGroup
	replies := make([]*httptest.ResponseRecorder, 20)
	for i := range replies {
		retries.Go(func() { replies[i] = do(winningToken, place(winningKey)) })
	}
	retries.Wait()
	for _, reply := range replies {
		replayed := expectAPI[result](t, reply, 200)
		if replayed.ID != orderID {
			t.Fatal("retry returned a different booking")
		}
	}
	recorded := expectAPI[result](t, callAPI(handler, "GET", "/api/operations/"+winningKey, winningToken, nil), 200)
	if recorded.ID != orderID {
		t.Fatal("operation readback returned a different booking")
	}
	inputChanged := place(winningKey)
	inputChanged.Booking.Phone = "13900000000"
	expectAPI[problem](t, do(winningToken, inputChanged), 409)
	expectAPI[problem](t, do(foreign, command{Action: "transition", ID: orderID, Mode: confirmed, Key: "foreign-order-confirm"}), 404)
	loser := cust
	if winner := winningToken; winner == cust {
		loser = other
	}
	expectAPI[problem](t, callAPI(handler, "GET", "/api/orders/"+orderID, loser, nil), 404)
	expectAPI[problem](t, callAPI(handler, "GET", "/api/orders/"+orderID, adminToken, nil), 404)
	own := expectAPI[order](t, callAPI(handler, "GET", "/api/orders/"+orderID, winningToken, nil), 200)
	if own.Phone != b.Phone {
		t.Fatal("the booking owner could not read their contact details")
	}
	staffView := callAPI(handler, "GET", "/api/state", front, nil)
	expectAPI[snapshot](t, staffView, 200)
	if strings.Contains(staffView.Body.String(), b.Phone) || strings.Contains(staffView.Body.String(), b.Name) {
		t.Fatal("staff list leaked contact data")
	}

	confirm := command{Action: "transition", ID: orderID, Mode: confirmed, Key: "staff-confirm-booking"}
	expectAPI[result](t, do(front, confirm), 200)
	unavailable := command{Action: "revise", ID: orderID, Key: "revise-no-room", Booking: b}
	unavailable.Booking.End = "2027-08-01"
	expectAPI[problem](t, do(winningToken, unavailable), 409)
	unavailable.Key = "revise-stopped-night"
	unavailable.Booking.Version = 1
	unavailable.Booking.End = "2027-03-05"
	expectAPI[result](t, do(front, command{Action: "calendar", Hotel: "qt", Room: "qt-garden", Calendar: []calendarChange{{
		Date: "2027-03-04", calendarEntry: calendarEntry{Total: 1, Price: price("2027-03-04"), Stopped: true, Version: 2},
	}}}), 200)
	expectAPI[problem](t, do(winningToken, unavailable), 409)
	kept := expectAPI[order](t, callAPI(handler, "GET", "/api/orders/"+orderID, winningToken, nil), 200)
	if kept.Version != 1 || kept.End != b.End || kept.Occupancy[b.Start] != promised || kept.Occupancy["2027-03-03"] != promised {
		t.Fatalf("failed revision changed the original: %+v", kept)
	}
	changed := command{Action: "revise", ID: orderID, Key: "revise-only-contact", Booking: b}
	changed.Booking.Version = 1
	changed.Booking.Phone = "13900001111"
	revised := expectAPI[result](t, do(winningToken, changed), 200)
	if revised.Order.Version != 2 || totalPrice(revised.Order.Nights, 1) != totalPrice(kept.Nights, 1) {
		t.Fatal("contact-only revision did not preserve quote")
	}

	setClock(time.Date(2027, 3, 2, 14, 0, 0, 0, beijing))
	front = login("/api/login", "desk-qt", "isolated-test-staff")
	expectAPI[result](t, do(front, command{Action: "transition", ID: orderID, Mode: staying, Key: "test-staff-checkin"}), 200)
	setClock(time.Date(2027, 3, 3, 11, 59, 0, 0, beijing))
	front = login("/api/login", "desk-qt", "isolated-test-staff")
	finished := expectAPI[result](t, do(front, command{Action: "transition", ID: orderID, Mode: checkedOut, Key: "test-staff-checkout"}), 200)
	if finished.Order.Occupancy["2027-03-02"] != consumed || finished.Order.Occupancy["2027-03-03"] != released {
		t.Fatalf("early checkout night states = %v", finished.Order.Occupancy)
	}
	stats := expectAPI[statistics](t, callAPI(handler, "GET", "/api/stats?start=2027-03-02&end=2027-03-04&room=qt-garden", front, nil), 200)
	if stats.Consumed != 1 || stats.Amount != price("2027-03-02") {
		t.Fatalf("unexpected checkout statistics %+v", stats)
	}
	reveal := command{Action: "contact", ID: orderID, Note: "stay"}
	if contact := expectAPI[result](t, do(front, reveal), 200); contact.Phone != changed.Booking.Phone || contact.Name != changed.Booking.Name {
		t.Fatalf("authorized disclosure returned unexpected contact details: %+v", contact)
	}
	expectAPI[problem](t, do(adminToken, command{Action: "contact", ID: orderID, Note: "incident"}), 401)

	lateStay := b
	lateStay.Start, lateStay.End = "2027-03-06", "2027-03-08"
	lateOffer, err := s.quote(ctx, "", "qt", "", lateStay.stay)
	if err != nil {
		t.Fatal(err)
	}
	lateStay.Nights = lateOffer.Nights
	guestNow := login("/api/login", "guest-a", "isolated-test-user")
	pendingOrder := expectAPI[result](t, do(guestNow, command{Action: "book", Key: "compete-timeout-confirm", Hotel: "qt", Booking: lateStay}), 200)
	setClock(time.UnixMilli(pendingOrder.Order.Deadline))
	var competition sync.WaitGroup
	var confirmation *httptest.ResponseRecorder
	var backgroundErr error
	competition.Go(func() {
		confirmation = do(front, command{Action: "transition", ID: pendingOrder.ID, Mode: confirmed, Key: "confirm-at-deadline"})
	})
	competition.Go(func() { backgroundErr = s.maintain(ctx) })
	competition.Wait()
	if backgroundErr != nil {
		t.Fatal(backgroundErr)
	}
	expectAPI[problem](t, confirmation, 409)
	timedOut := expectAPI[order](t, callAPI(handler, "GET", "/api/orders/"+pendingOrder.ID, guestNow, nil), 200)
	if timedOut.Status != expired || timedOut.Occupancy[lateStay.Start] != released {
		t.Fatalf("deadline did not win the race: %+v", timedOut)
	}

	lateStay.Room = "qt-window"
	lateOffer, err = s.quote(ctx, "", "qt", "", lateStay.stay)
	if err != nil {
		t.Fatal(err)
	}
	lateStay.Nights = lateOffer.Nights
	affected := expectAPI[result](t, do(guestNow, command{Action: "book", Key: "incident-booking", Hotel: "qt", Booking: lateStay}), 200)
	expectAPI[result](t, do(front, command{Action: "transition", ID: affected.ID, Mode: confirmed, Key: "confirm-incident-order"}), 200)
	previewURL := fmt.Sprintf("/api/incidents/preview?hotel=qt&room=%s&start=%s&end=%s", lateStay.Room, lateStay.Start, lateStay.End)
	adminToken = login("/api/login", "admin", "isolated-test-admin")
	foreign = login("/api/login", "desk-xw", "isolated-test-staff")
	expectAPI[problem](t, callAPI(handler, "GET", previewURL, guestNow, nil), 403)
	expectAPI[problem](t, callAPI(handler, "GET", previewURL, foreign, nil), 403)
	if preview := expectAPI[struct{ Count int }](t, callAPI(handler, "GET", previewURL, adminToken, nil), 200); preview.Count != 1 {
		t.Fatalf("admin incident preview count = %d, want 1", preview.Count)
	}
	if preview := expectAPI[struct{ Count int }](t, callAPI(handler, "GET", previewURL, front, nil), 200); preview.Count != 1 {
		t.Fatalf("staff incident preview count = %d, want 1", preview.Count)
	}
	event := expectAPI[result](t, do(front, command{Action: "incident_open", Hotel: "qt",
		Incident: incident{Room: lateStay.Room, Start: lateStay.Start, End: lateStay.End, Title: "临时检修", Reason: "供水检修\n需要停水"},
	}), 200)
	expectAPI[problem](t, do(front, command{Action: "incident_close", ID: event.ID}), 409)
	touch := command{Action: "incident_update", ID: event.ID, Incident: incident{ID: affected.ID},
		Mode: "contacting", Note: "首次未接通\n稍后再拨"}
	expectAPI[result](t, do(front, touch), 200)
	stillConfirmed := expectAPI[order](t, callAPI(handler, "GET", "/api/orders/"+affected.ID, guestNow, nil), 200)
	if stillConfirmed.Status != confirmed || stillConfirmed.Occupancy[lateStay.Start] != promised {
		t.Fatalf("contacting changed the order or occupancy: %+v", stillConfirmed)
	}
	touch.Mode, touch.Note = "reached", "已联系并说明停业\n已登记处置"
	expectAPI[result](t, do(front, touch), 200)
	expectAPI[result](t, do(front, command{Action: "incident_close", ID: event.ID, Mode: "resume"}), 200)
	afterIncident := expectAPI[order](t, callAPI(handler, "GET", "/api/orders/"+affected.ID, guestNow, nil), 200)
	if afterIncident.Status != cancelled || afterIncident.Occupancy[lateStay.Start] != released {
		t.Fatalf("hotel cancellation did not release the commitment: %+v", afterIncident)
	}
	afterCloseView := expectAPI[snapshot](t, callAPI(handler, "GET", "/api/state", front, nil), 200)
	if afterCloseView.Calendar["qt/"+lateStay.Room+"/"+lateStay.Start].Stopped {
		t.Fatal("incident_close with resume mode did not clear stopped flag")
	}
	adminView := expectAPI[snapshot](t, callAPI(handler, "GET", "/api/state", adminToken, nil), 200)
	for label, logs := range map[string][]auditEntry{"admin": adminView.Audit, "staff": afterCloseView.Audit} {
		if len(logs) < 12 {
			t.Fatalf("%s audit count = %d, want >= 12 to verify numeric ordering past 10", label, len(logs))
		}
		var prev int64
		for i, entry := range logs {
			id, err := strconv.ParseInt(entry.ID, 10, 64)
			if err != nil {
				t.Fatalf("%s invalid audit id %q: %v", label, entry.ID, err)
			}
			if i > 0 && id >= prev {
				t.Fatalf("%s audit not sorted numerically descending at index %d: prev=%d, curr=%d", label, i, prev, id)
			}
			prev = id
		}
	}

	setClock(time.UnixMilli(finished.Order.TerminalAt).Add(7 * 24 * time.Hour))
	front = login("/api/login", "desk-qt", "isolated-test-staff")
	if got := expectAPI[problem](t, do(front, reveal), 409); got.Code != "privacy_expired" {
		t.Fatalf("unexpected contact deadline result: %+v", got)
	}
	if err := s.maintain(ctx); err != nil {
		t.Fatal(err)
	}
	var phone, masked string
	if err := s.pool.QueryRow(ctx, "SELECT phone,tail FROM contacts WHERE order_id=$1", orderID).Scan(&phone, &masked); err != nil {
		t.Fatal(err)
	}
	if phone != "" || masked != "1111" {
		t.Fatal("expired contact was not purged")
	}
	adminToken = login("/api/login", "admin", "isolated-test-admin")
	expectAPI[result](t, do(adminToken, command{Action: "staff_enabled", ID: staffID, Enabled: false}), 200)
	expectAPI[problem](t, callAPI(handler, "GET", "/api/state", front, nil), 401)

	if err := s.verifyStore(ctx); err != nil {
		t.Fatal(err)
	}
}

func uploadMultipartPhoto(handler http.Handler, token, hotelID, caption, filename string, data []byte) *httptest.ResponseRecorder {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("hotel", hotelID)
	_ = writer.WriteField("caption", caption)
	part, _ := writer.CreateFormFile("file", filename)
	_, _ = part.Write(data)
	_ = writer.Close()

	r := httptest.NewRequest(http.MethodPost, "/api/photos", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestHotelPhotosAndProfileLifecycle(t *testing.T) {
	s, _ := postgresTestService(t)
	ctx := context.Background()
	handler := s.routes(t.TempDir(), nil)
	login := func(path, username, password string) string {
		t.Helper()
		return expectAPI[signInResult](t, callAPI(handler, "POST", path, "", credentials{
			Username: username, Password: password,
		}), 200).Token
	}
	adminToken := login("/api/login", "admin", "isolated-test-admin")
	cust := login("/api/register", "photo-guest", "isolated-test-user")
	do := func(token string, c command) *httptest.ResponseRecorder {
		return callAPI(handler, "POST", "/api/commands", token, c)
	}
	expectAPI[result](t, do(adminToken, command{Action: "staff_create",
		User: credentials{Username: "photo-qt", Password: "isolated-test-staff", Hotel: "qt"}}), 200)
	expectAPI[result](t, do(adminToken, command{Action: "staff_create",
		User: credentials{Username: "photo-xw", Password: "isolated-test-staff", Hotel: "xw"}}), 200)
	front := login("/api/login", "photo-qt", "isolated-test-staff")
	foreign := login("/api/login", "photo-xw", "isolated-test-staff")

	created := expectAPI[result](t, do(adminToken, command{
		Action: "hotel",
		Property: hotel{
			Name: "新设驿馆", City: "苏州", District: "姑苏区",
			Address: "平江路 1 号", Phone: "0512-00001111", Caption: "小桥流水旁",
		},
	}), 200)
	view := expectAPI[snapshot](t, callAPI(handler, "GET", "/api/state", adminToken, nil), 200)
	var newHotel *hotel
	for i := range view.Hotels {
		if view.Hotels[i].ID == created.ID {
			newHotel = &view.Hotels[i]
			break
		}
	}
	if newHotel == nil || newHotel.Image != "" || len(newHotel.Photos) != 0 || newHotel.District != "姑苏区" || newHotel.Caption != "小桥流水旁" {
		t.Fatalf("unexpected newly created hotel state: %+v", newHotel)
	}

	expectAPI[result](t, do(front, command{
		Action: "hotel",
		Hotel:  "qt",
		Property: hotel{
			Name: "秦淮 · 栖庭", City: "南京", District: "老门东",
			Address: "南京市秦淮区庭院路 18 号", Phone: "025-00000001", Caption: "白墙青瓦与晨光。", Description: "更新简介\n支持多行段落",
		},
	}), 200)
	expectAPI[result](t, do(front, command{
		Action: "room",
		Hotel:  "qt",
		Room:   "qt-garden",
		RoomType: room{
			Name: "庭院大床房", Capacity: 2, Size: 32, Bed: "1 张 1.8m 大床",
			Description: "庭院景观\n独立卫浴", Enabled: true,
		},
	}), 200)

	pngBytes, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	expectAPI[problem](t, uploadMultipartPhoto(handler, front, "qt", "非法", "evil.html", []byte("<html>not-image</html>")), 400)
	expectAPI[problem](t, uploadMultipartPhoto(handler, foreign, "qt", "越权", "a.png", pngBytes), 403)
	expectAPI[problem](t, uploadMultipartPhoto(handler, cust, "qt", "越权", "a.png", pngBytes), 403)

	uploaded := expectAPI[hotelPhoto](t, uploadMultipartPhoto(handler, front, "qt", "定制实景", "custom.png", pngBytes), 200)
	if uploaded.URL != "/api/photos/"+uploaded.ID {
		t.Fatalf("unexpected uploaded photo url: %+v", uploaded)
	}
	fetched := callAPI(handler, http.MethodGet, uploaded.URL, "", nil)
	if fetched.Code != 200 || fetched.Header().Get("Content-Type") != "image/png" ||
		fetched.Header().Get("X-Content-Type-Options") != "nosniff" ||
		fetched.Header().Get("Cross-Origin-Resource-Policy") != "cross-origin" ||
		!strings.Contains(fetched.Header().Get("Cache-Control"), "immutable") ||
		!bytes.Equal(fetched.Body.Bytes(), pngBytes) {
		t.Fatalf("unexpected GET photo response: code=%d headers=%v len=%d", fetched.Code, fetched.Header(), fetched.Body.Len())
	}

	expectAPI[problem](t, do(front, command{Action: "photo_add_preset", Hotel: "qt", PhotoURL: "/images/unknown.png"}), 400)
	presetRes := expectAPI[result](t, do(front, command{Action: "photo_add_preset", Hotel: "qt", PhotoURL: "/images/lake-room.png", Note: "窗畔茶席"}), 200)
	if presetRes.Photo == nil || presetRes.Photo.URL != "/images/lake-room.png" {
		t.Fatalf("unexpected preset result: %+v", presetRes)
	}

	view = expectAPI[snapshot](t, callAPI(handler, "GET", "/api/state", "", nil), 200)
	var qtHotel hotel
	for _, h := range view.Hotels {
		if h.ID == "qt" {
			qtHotel = h
			break
		}
	}
	if qtHotel.District != "老门东" || qtHotel.Caption != "白墙青瓦与晨光。" || len(qtHotel.Photos) != 4 {
		t.Fatalf("unexpected qt hotel after uploads: %+v", qtHotel)
	}

	order := []string{uploaded.ID}
	for _, p := range qtHotel.Photos {
		if p.ID != uploaded.ID {
			order = append(order, p.ID)
		}
	}
	expectAPI[result](t, do(front, command{Action: "photo_reorder", Hotel: "qt", PhotoOrder: order}), 200)
	expectAPI[result](t, do(front, command{Action: "photo_caption", Hotel: "qt", ID: uploaded.ID, Note: "新封面说明"}), 200)

	view = expectAPI[snapshot](t, callAPI(handler, "GET", "/api/state", "", nil), 200)
	for _, h := range view.Hotels {
		if h.ID == "qt" {
			qtHotel = h
			break
		}
	}
	if qtHotel.Image != uploaded.URL || qtHotel.Photos[0].ID != uploaded.ID || qtHotel.Photos[0].Caption != "新封面说明" {
		t.Fatalf("reorder or caption did not sync cover: %+v", qtHotel)
	}

	for _, p := range qtHotel.Photos {
		expectAPI[result](t, do(front, command{Action: "photo_delete", Hotel: "qt", ID: p.ID}), 200)
	}
	if err := s.migrate(ctx); err != nil {
		t.Fatal(err)
	}
	view = expectAPI[snapshot](t, callAPI(handler, "GET", "/api/state", "", nil), 200)
	for _, h := range view.Hotels {
		if h.ID == "qt" && (h.Image != "" || len(h.Photos) != 0) {
			t.Fatalf("deleted photos resurrected or cover remained: %+v", h)
		}
	}
	if err := s.verifyStore(ctx); err != nil {
		t.Fatal(err)
	}
}
