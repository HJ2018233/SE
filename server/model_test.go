package main

import (
	"strings"
	"testing"
)

func TestCleanTextAndMultilineText(t *testing.T) {
	if got := cleanText("  单行\t文本  ", 20); got != "" {
		t.Fatalf("cleanText should reject tab, got %q", got)
	}
	if got := cleanText("第一行\n第二行", 20); got != "" {
		t.Fatalf("cleanText should reject newline, got %q", got)
	}

	if got := cleanMultilineText("  第一行\r\n第二行\r第三行\t附注  ", 40); got != "第一行\n第二行\n第三行\t附注" {
		t.Fatalf("unexpected cleanMultilineText result: %q", got)
	}
	if got := cleanMultilineText("非法\x00字符", 40); got != "" {
		t.Fatalf("cleanMultilineText should reject NUL byte, got %q", got)
	}
	if got := cleanMultilineText(strings.Repeat("字", 11), 10); got != "" {
		t.Fatalf("cleanMultilineText should enforce rune limit, got %q", got)
	}
}

func TestAuthorizedCommandBoundaries(t *testing.T) {
	adminAcct := account{ID: "U1", Role: admin, Enabled: true}
	staffAcct := account{ID: "U2", Role: staff, Hotel: "qt", Enabled: true}
	custAcct := account{ID: "U3", Role: customer, Enabled: true}

	if authorizedCommand(adminAcct, command{Action: "calendar", Hotel: "qt", Room: "qt-garden"}) {
		t.Fatal("admin should not be authorized for calendar command")
	}
	if !authorizedCommand(staffAcct, command{Action: "calendar", Hotel: "qt", Room: "qt-garden"}) {
		t.Fatal("staff should be authorized for calendar command")
	}
	if !authorizedCommand(adminAcct, command{Action: "hotel"}) {
		t.Fatal("admin should be authorized to create hotel")
	}
	if authorizedCommand(adminAcct, command{Action: "hotel", Hotel: "qt"}) {
		t.Fatal("admin should not be authorized to update existing hotel profile")
	}
	if !authorizedCommand(staffAcct, command{Action: "hotel", Hotel: "qt"}) {
		t.Fatal("staff should be authorized to update own hotel profile")
	}
	if !authorizedCommand(adminAcct, command{Action: "incident_close", ID: "EV1"}) {
		t.Fatal("admin should be authorized for incident_close")
	}
	if authorizedCommand(custAcct, command{Action: "incident_close", ID: "EV1"}) {
		t.Fatal("customer should not be authorized for incident_close")
	}
}
