package main

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	maxHotelPhotos = 12
	maxPhotoBytes  = 2 * 1024 * 1024
)

var presetPhotoURLs = map[string]bool{
	"/images/courtyard-room.png":  true,
	"/images/lake-room.png":       true,
	"/images/garden-entrance.png": true,
}

var allowedPhotoTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

func photoURL(id, sourceURL string) string {
	if sourceURL != "" {
		return sourceURL
	}
	return "/api/photos/" + id
}

func syncHotelCover(ctx context.Context, tx pgx.Tx, hotelID string) error {
	var id, sourceURL string
	err := tx.QueryRow(ctx, `
		SELECT id,source_url FROM hotel_photos
		WHERE hotel_id=$1
		ORDER BY sort_order,created_at,id
		LIMIT 1`, hotelID).Scan(&id, &sourceURL)
	cover := ""
	if err == nil {
		cover = photoURL(id, sourceURL)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return sqlExec(ctx, tx, "UPDATE hotels SET image=$2 WHERE id=$1", hotelID, cover)
}

func repackPhotoOrder(ctx context.Context, tx pgx.Tx, hotelID string) error {
	rows, err := tx.Query(ctx, `
		SELECT id FROM hotel_photos WHERE hotel_id=$1 ORDER BY sort_order,created_at,id`, hotelID)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	for i, id := range ids {
		if err := sqlExec(ctx, tx, "UPDATE hotel_photos SET sort_order=$2 WHERE id=$1", id, i); err != nil {
			return err
		}
	}
	return syncHotelCover(ctx, tx, hotelID)
}

func (s *service) uploadPhoto(ctx context.Context, token, hotelID, caption string, data []byte) (hotelPhoto, error) {
	if hotelID == "" {
		return hotelPhoto{}, bad("请选择酒店")
	}
	if len(data) == 0 {
		return hotelPhoto{}, bad("请选择需要上传的图片文件")
	}
	if len(data) > maxPhotoBytes {
		return hotelPhoto{}, bad("图片大小不能超过 2 MB")
	}
	ct := http.DetectContentType(data)
	if !allowedPhotoTypes[ct] {
		return hotelPhoto{}, bad("仅支持 JPG、PNG 或 WebP 格式的图片")
	}
	cleanCaption := cleanText(caption, 80)

	var out hotelPhoto
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		now := s.clock()
		a, err := actor(ctx, tx, token, now)
		if err != nil {
			return err
		}
		if a.Role != staff || a.Hotel != hotelID {
			return forbidden()
		}
		if err := lockHotel(ctx, tx, hotelID); err != nil {
			return err
		}
		var count, nextOrder int
		if err := tx.QueryRow(ctx, `
			SELECT count(*), COALESCE(max(sort_order)+1, 0)
			FROM hotel_photos WHERE hotel_id=$1`, hotelID).Scan(&count, &nextOrder); err != nil {
			return err
		}
		if count >= maxHotelPhotos {
			return bad("每家酒店最多保留 12 张照片")
		}
		id := randomID("P")
		if err := sqlExec(ctx, tx, `
			INSERT INTO hotel_photos(id,hotel_id,sort_order,caption,content_type,data,source_url)
			VALUES($1,$2,$3,$4,$5,$6,'')`,
			id, hotelID, nextOrder, cleanCaption, ct, data); err != nil {
			return err
		}
		if err := syncHotelCover(ctx, tx, hotelID); err != nil {
			return err
		}
		out = hotelPhoto{ID: id, URL: photoURL(id, ""), Caption: cleanCaption}
		return audit(ctx, tx, now, a, hotelID, "上传酒店图片", hotelID+"/"+id, "添加酒店实景照片", "成功")
	})
	return out, err
}

func (s *service) readPhoto(ctx context.Context, id string) (string, []byte, error) {
	if id == "" {
		return "", nil, missing()
	}
	var ct string
	var data []byte
	err := s.pool.QueryRow(ctx, "SELECT content_type,data FROM hotel_photos WHERE id=$1", id).Scan(&ct, &data)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && len(data) == 0) {
		return "", nil, missing()
	}
	return ct, data, err
}

func addPresetPhoto(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	if !presetPhotoURLs[c.PhotoURL] {
		return result{}, bad("请选择内置示例图库中的图片")
	}
	var count, nextOrder int
	if err := tx.QueryRow(ctx, `
		SELECT count(*), COALESCE(max(sort_order)+1, 0)
		FROM hotel_photos WHERE hotel_id=$1`, c.Hotel).Scan(&count, &nextOrder); err != nil {
		return result{}, err
	}
	if count >= maxHotelPhotos {
		return result{}, bad("每家酒店最多保留 12 张照片")
	}
	id := randomID("P")
	caption := cleanText(c.Note, 80)
	if err := sqlExec(ctx, tx, `
		INSERT INTO hotel_photos(id,hotel_id,sort_order,caption,content_type,data,source_url)
		VALUES($1,$2,$3,$4,'',''::bytea,$5)`,
		id, c.Hotel, nextOrder, caption, c.PhotoURL); err != nil {
		return result{}, err
	}
	if err := syncHotelCover(ctx, tx, c.Hotel); err != nil {
		return result{}, err
	}
	photo := hotelPhoto{ID: id, URL: photoURL(id, c.PhotoURL), Caption: caption}
	if err := audit(ctx, tx, now, a, c.Hotel, "添加酒店示例图片", c.Hotel+"/"+id, "从内置图库选取图片", "成功"); err != nil {
		return result{}, err
	}
	return result{ID: id, Photo: &photo}, nil
}

func reorderPhotos(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	rows, err := tx.Query(ctx, "SELECT id FROM hotel_photos WHERE hotel_id=$1", c.Hotel)
	if err != nil {
		return result{}, err
	}
	existing := make(map[string]bool)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return result{}, err
		}
		existing[id] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result{}, err
	}
	rows.Close()

	if len(c.PhotoOrder) == 0 || len(c.PhotoOrder) != len(existing) {
		return result{}, bad("图片排序列表与当前相册不一致，请刷新后重试")
	}
	seen := make(map[string]bool, len(c.PhotoOrder))
	for _, id := range c.PhotoOrder {
		if !existing[id] || seen[id] {
			return result{}, bad("图片排序列表包含无效或重复项")
		}
		seen[id] = true
	}
	for i, id := range c.PhotoOrder {
		if err := sqlExec(ctx, tx, "UPDATE hotel_photos SET sort_order=$2 WHERE id=$1 AND hotel_id=$3", id, i, c.Hotel); err != nil {
			return result{}, err
		}
	}
	if err := syncHotelCover(ctx, tx, c.Hotel); err != nil {
		return result{}, err
	}
	return result{ID: c.Hotel}, audit(ctx, tx, now, a, c.Hotel, "调整酒店图片顺序", c.Hotel, "更新相册排序与封面图", "成功")
}

func updatePhotoCaption(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	if c.ID == "" {
		return result{}, bad("请选择要编辑的图片")
	}
	caption := cleanText(c.Note, 80)
	tag, err := tx.Exec(ctx, "UPDATE hotel_photos SET caption=$3 WHERE id=$1 AND hotel_id=$2", c.ID, c.Hotel, caption)
	if err != nil {
		return result{}, err
	}
	if tag.RowsAffected() == 0 {
		return result{}, missing()
	}
	return result{ID: c.ID}, audit(ctx, tx, now, a, c.Hotel, "编辑酒店图片说明", c.Hotel+"/"+c.ID, "更新图片说明文字", "成功")
}

func deletePhoto(ctx context.Context, tx pgx.Tx, a account, now time.Time, c command) (result, error) {
	if c.ID == "" {
		return result{}, bad("请选择要删除的图片")
	}
	tag, err := tx.Exec(ctx, "DELETE FROM hotel_photos WHERE id=$1 AND hotel_id=$2", c.ID, c.Hotel)
	if err != nil {
		return result{}, err
	}
	if tag.RowsAffected() == 0 {
		return result{}, missing()
	}
	if err := repackPhotoOrder(ctx, tx, c.Hotel); err != nil {
		return result{}, err
	}
	return result{ID: c.ID}, audit(ctx, tx, now, a, c.Hotel, "删除酒店图片", c.Hotel+"/"+c.ID, "移除相册图片并刷新封面", "成功")
}
