package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

func decode(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return bad("请检查提交的数据格式")
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return bad("请求应只含一个 JSON 对象")
	}
	return nil
}

func send(w http.ResponseWriter, data any, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if err != nil {
		p := asProblem(err)
		if p == nil {
			// Driver errors can include raw input. Record only their type here.
			slog.Error("request failed", "error_type", fmt.Sprintf("%T", err))
			p = &problem{Status: 500, Code: "server", Text: "服务暂时无法完成请求，请稍后查回结果"}
		}
		w.WriteHeader(p.Status)
		data = p
	}
	_ = json.NewEncoder(w).Encode(data)
}

func authToken(r *http.Request) string {
	prefix, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
	if !strings.EqualFold(prefix, "Bearer") {
		return ""
	}
	return token
}

func (s *service) routes(static string, corsOrigins []string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		send(w, struct {
			Ready bool `json:"ready"`
		}{true}, s.pool.Ping(r.Context()))
	})
	// Bound the number of password hash calculations in progress.
	authSlots := make(chan struct{}, 8)
	for _, path := range []string{"login", "register"} {
		mux.HandleFunc("POST /api/"+path, func(w http.ResponseWriter, r *http.Request) {
			select {
			case authSlots <- struct{}{}:
				defer func() { <-authSlots }()
			default:
				send(w, nil, &problem{Status: 429, Code: "busy", Text: "登录请求较多，请稍后重试"})
				return
			}
			var in credentials
			if err := decode(w, r, &in); err != nil {
				send(w, nil, err)
				return
			}
			value, err := s.signIn(r.Context(), in, path == "register")
			send(w, value, err)
		})
	}
	mux.HandleFunc("POST /api/logout", func(w http.ResponseWriter, r *http.Request) {
		err := s.logout(r.Context(), authToken(r))
		send(w, struct{}{}, err)
	})
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.snapshot(r.Context(), authToken(r))
		send(w, value, err)
	})
	mux.HandleFunc("GET /api/orders", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.findOrders(r.Context(), authToken(r), r.URL.Query())
		send(w, value, err)
	})
	mux.HandleFunc("GET /api/orders/{id}", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.orderDetail(r.Context(), authToken(r), r.PathValue("id"))
		send(w, value, err)
	})
	mux.HandleFunc("GET /api/operations/{key}", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.operation(r.Context(), authToken(r), r.PathValue("key"))
		send(w, value, err)
	})
	mux.HandleFunc("GET /api/search", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.search(r.Context(), r.URL.Query())
		send(w, value, err)
	})
	mux.HandleFunc("GET /api/quote", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		people, _ := strconv.Atoi(q.Get("people"))
		rooms, _ := strconv.Atoi(q.Get("rooms"))
		value, err := s.quote(r.Context(), authToken(r), q.Get("hotel"), q.Get("order"),
			stay{Room: q.Get("room"), Start: q.Get("start"), End: q.Get("end"), People: people, Rooms: rooms})
		send(w, value, err)
	})
	mux.HandleFunc("GET /api/stats", func(w http.ResponseWriter, r *http.Request) {
		value, err := s.stats(r.Context(), authToken(r), r.URL.Query())
		send(w, value, err)
	})
	mux.HandleFunc("POST /api/commands", func(w http.ResponseWriter, r *http.Request) {
		var in command
		if err := decode(w, r, &in); err != nil {
			send(w, nil, err)
			return
		}
		value, err := s.execute(r.Context(), authToken(r), in)
		send(w, value, err)
	})
	mux.HandleFunc("POST /api/photos", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxPhotoBytes+64*1024)
		if err := r.ParseMultipartForm(maxPhotoBytes); err != nil {
			send(w, nil, bad("请上传不超过 2 MB 的图片文件"))
			return
		}
		if r.MultipartForm != nil {
			defer r.MultipartForm.RemoveAll()
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			send(w, nil, bad("请选择需要上传的图片文件"))
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, maxPhotoBytes+1))
		if err != nil {
			send(w, nil, bad("读取图片文件失败"))
			return
		}
		photo, err := s.uploadPhoto(r.Context(), authToken(r), r.FormValue("hotel"), r.FormValue("caption"), data)
		send(w, photo, err)
	})
	mux.HandleFunc("GET /api/photos/{id}", func(w http.ResponseWriter, r *http.Request) {
		ct, data, err := s.readPhoto(r.Context(), r.PathValue("id"))
		if err != nil {
			send(w, nil, err)
			return
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Disposition", "inline")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) { send(w, nil, missing()) })
	if static != "" {
		mux.Handle("/", http.FileServer(http.Dir(static)))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if strings.HasPrefix(r.URL.Path, "/api/") && origin != "" {
			w.Header().Add("Vary", "Origin")
			for _, allowed := range corsOrigins {
				if allowed != "" && origin == allowed {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
					if r.Method == http.MethodOptions {
						w.WriteHeader(http.StatusNoContent)
						return
					}
					break
				}
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func originList(input string) []string {
	var origins []string
	for _, origin := range strings.Split(input, ",") {
		if origin := strings.TrimSpace(origin); origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}

func cleanServerError(err error) bool {
	return errors.Is(err, http.ErrServerClosed)
}
