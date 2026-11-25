package main

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	customer = "customer"
	staff    = "staff"
	admin    = "admin"

	pending    = "待确认"
	confirmed  = "已确认"
	staying    = "已入住"
	checkedOut = "已退房"
	cancelled  = "已取消"
	rejected   = "已拒绝"
	expired    = "已超时"

	held     = "预占"
	promised = "承诺"
	inHouse  = "在住占用"
	consumed = "已消费"
	released = "已释放"

	dateLayout = "2006-01-02"
	maxPrice   = 1_000_000_000
	maxRooms   = 10000
)

var (
	beijing       = time.FixedZone("Asia/Shanghai", 8*60*60)
	phonePattern  = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
	userPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,63}$`)
	keyPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{12,100}$`)
	numberPattern = regexp.MustCompile(`[0-9]{7,}`)
)

type problem struct {
	Status int     `json:"status"`
	Code   string  `json:"code"`
	Text   string  `json:"message"`
	Nights []night `json:"nights,omitempty"`
	Order  string  `json:"order,omitempty"`
	Date   string  `json:"date,omitempty"`
}

func (p *problem) Error() string { return p.Text }

func bad(text string) *problem {
	return &problem{Status: http.StatusBadRequest, Code: "invalid", Text: text}
}

func missing() *problem {
	return &problem{Status: http.StatusNotFound, Code: "not_found", Text: "记录不存在或无权访问"}
}

func forbidden() *problem {
	return &problem{Status: http.StatusForbidden, Code: "forbidden", Text: "当前身份无权执行该操作"}
}

func conflict(code, message string) *problem {
	return &problem{Status: http.StatusConflict, Code: code, Text: message}
}

func unauthenticated() *problem {
	return &problem{Status: http.StatusUnauthorized, Code: "session", Text: "请登录后继续"}
}

type account struct {
	ID       string `json:"id"`
	Username string `json:"username,omitempty"`
	Label    string `json:"label"`
	Role     string `json:"role"`
	Hotel    string `json:"hotel"`
	Enabled  bool   `json:"enabled"`
}

func (a account) mayManage(hotel string) bool {
	return a.Role == admin || (a.Role == staff && a.Hotel == hotel)
}

type hotelPhoto struct {
	ID      string `json:"id"`
	URL     string `json:"url"`
	Caption string `json:"caption"`
}

type hotel struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	City        string       `json:"city"`
	Address     string       `json:"address"`
	Phone       string       `json:"phone"`
	District    string       `json:"district"`
	Image       string       `json:"image"`
	Caption     string       `json:"caption"`
	Description string       `json:"description"`
	Enabled     bool         `json:"enabled"`
	Photos      []hotelPhoto `json:"photos"`
}

type room struct {
	ID          string `json:"id"`
	Hotel       string `json:"hotel"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Capacity    int    `json:"capacity"`
	Size        int    `json:"size"`
	Bed         string `json:"bed"`
	Enabled     bool   `json:"enabled"`
}

type calendarEntry struct {
	Total    int   `json:"total"`
	Price    int64 `json:"price"`
	Stopped  bool  `json:"stopped"`
	Version  int   `json:"version"`
	Occupied int   `json:"occupied"`
}

type calendarChange struct {
	Date string `json:"date"`
	calendarEntry
}

type night struct {
	Date  string `json:"date"`
	Price int64  `json:"price"`
}

type stay struct {
	Room   string `json:"room"`
	Start  string `json:"start"`
	End    string `json:"end"`
	People int    `json:"people"`
	Rooms  int    `json:"rooms"`
}

type booking struct {
	stay
	Name    string  `json:"name"`
	Phone   string  `json:"phone"`
	Version int     `json:"version,omitempty"`
	Nights  []night `json:"nights"`
}

type historyItem struct {
	Time string `json:"time"`
	Text string `json:"text"`
}

type order struct {
	stay
	ID         string            `json:"id"`
	Hotel      string            `json:"hotel"`
	Owner      string            `json:"owner"`
	Status     string            `json:"status"`
	Version    int               `json:"version"`
	Nights     []night           `json:"nights"`
	Created    int64             `json:"created"`
	Deadline   int64             `json:"deadline"`
	TerminalAt int64             `json:"terminalAt,omitempty"`
	Checkout   string            `json:"checkout,omitempty"`
	PhoneTail  string            `json:"phoneTail,omitempty"`
	Incident   string            `json:"incident,omitempty"`
	Name       string            `json:"name,omitempty"`
	Phone      string            `json:"phone,omitempty"`
	History    []historyItem     `json:"history"`
	Occupancy  map[string]string `json:"occupancy"`
}

type incidentItem struct {
	Order     string `json:"order"`
	Progress  string `json:"progress"`
	Notes     string `json:"notes"`
	ContactAt string `json:"contactAt,omitempty"`
}

type incident struct {
	ID     string         `json:"id"`
	Hotel  string         `json:"hotel"`
	Title  string         `json:"title"`
	Reason string         `json:"reason"`
	Start  string         `json:"start"`
	End    string         `json:"end"`
	Room   string         `json:"room"`
	Closed bool           `json:"closed"`
	Items  []incidentItem `json:"items"`
}

type auditEntry struct {
	ID     string `json:"id"`
	At     string `json:"at"`
	Role   string `json:"role"`
	Action string `json:"action"`
	Object string `json:"object"`
	Detail string `json:"detail"`
	Result string `json:"result"`
}

type snapshot struct {
	Account   *account                 `json:"account"`
	Hotels    []hotel                  `json:"hotels"`
	Rooms     []room                   `json:"rooms"`
	Calendar  map[string]calendarEntry `json:"calendar"`
	Orders    []order                  `json:"orders"`
	Incidents []incident               `json:"incidents"`
	Audit     []auditEntry             `json:"audit"`
	Accounts  []account                `json:"accounts"`
}

type command struct {
	Action     string           `json:"action"`
	Key        string           `json:"key,omitempty"`
	Hotel      string           `json:"hotel,omitempty"`
	Room       string           `json:"room,omitempty"`
	ID         string           `json:"id,omitempty"`
	Note       string           `json:"note,omitempty"`
	Mode       string           `json:"mode,omitempty"`
	Enabled    bool             `json:"enabled,omitempty"`
	Booking    booking          `json:"booking,omitempty"`
	Calendar   []calendarChange `json:"calendar,omitempty"`
	Property   hotel            `json:"property,omitempty"`
	RoomType   room             `json:"roomType,omitempty"`
	Incident   incident         `json:"incident,omitempty"`
	User       credentials      `json:"user,omitempty"`
	PhotoOrder []string         `json:"photoOrder,omitempty"`
	PhotoURL   string           `json:"photoUrl,omitempty"`
}

type result struct {
	ID      string      `json:"id,omitempty"`
	Order   *order      `json:"order,omitempty"`
	Name    string      `json:"name,omitempty"`
	Phone   string      `json:"phone,omitempty"`
	Photo   *hotelPhoto `json:"photo,omitempty"`
	Problem *problem    `json:"problem,omitempty"`
}

func dateAt(t time.Time) string { return t.In(beijing).Format(dateLayout) }
func eventTime(t time.Time) string {
	return t.In(beijing).Format(time.RFC3339)
}

func parseDate(s string) (time.Time, error) {
	t, err := time.ParseInLocation(dateLayout, s, beijing)
	if err != nil || t.Format(dateLayout) != s || t.Year() < 2000 || t.Year() > 2200 {
		return time.Time{}, bad("请填写有效的住宿日期")
	}
	return t, nil
}

func stayDates(start, end string, limit int) ([]string, error) {
	first, err := parseDate(start)
	if err != nil {
		return nil, err
	}
	last, err := parseDate(end)
	if err != nil {
		return nil, err
	}
	if !last.After(first) || last.After(first.AddDate(0, 0, limit)) {
		return nil, bad(fmt.Sprintf("日期区间须为 1 至 %d 晚", limit))
	}
	dates := make([]string, 0, int(last.Sub(first)/(24*time.Hour)))
	for d := first; d.Before(last); d = d.AddDate(0, 0, 1) {
		dates = append(dates, dateAt(d))
	}
	return dates, nil
}

func validateStay(s stay) ([]string, error) {
	if s.Room == "" || s.Rooms < 1 || s.Rooms > 3 || s.People < s.Rooms || s.People > 300 {
		return nil, bad("请选择房型、1 至 3 间房，并填写有效入住人数")
	}
	return stayDates(s.Start, s.End, 14)
}

func validateSale(s stay, now time.Time) error {
	if s.Start < dateAt(now) || (s.Start == dateAt(now) && now.In(beijing).Hour() >= 18) {
		return conflict("cutoff", "入住日期已过可预订时间")
	}
	return nil
}

func cleanText(s string, limit int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > limit || strings.ContainsFunc(s, unicode.IsControl) {
		return ""
	}
	return s
}

func cleanMultilineText(s string, limit int) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > limit || strings.ContainsFunc(s, func(r rune) bool {
		return unicode.IsControl(r) && r != '\n' && r != '\t'
	}) {
		return ""
	}
	return s
}

func safeNote(s string) string {
	return numberPattern.ReplaceAllString(s, "〔号码已隐藏〕")
}

func totalPrice(nights []night, count int) int64 {
	var total int64
	for _, n := range nights {
		total += n.Price * int64(count)
	}
	return total
}

func isActive(status string) bool {
	return status == pending || status == confirmed || status == staying
}

func asProblem(err error) *problem {
	var p *problem
	if errors.As(err, &p) {
		return p
	}
	return nil
}
