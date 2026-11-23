import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Spinner,
  Text,
} from "@fluentui/react-components";
import {
  ArrowDown16Regular,
  ArrowUp16Regular,
  ArrowUpload20Regular,
  Checkmark20Regular,
  Delete16Regular,
  ImageAdd20Regular,
  Star16Filled,
  Star16Regular,
} from "@fluentui/react-icons";
import { api, errorMessage } from "../api";
import { useApp } from "../context";
import { hotelPhotos } from "../model";
import type { Hotel, HotelPhoto } from "../model";
import {
  blobToDataUrl,
  compressImageForUpload,
  PRESET_PHOTOS,
} from "../photos";
import type { PresetPhoto } from "../photos";
import { HotelImage } from "./HotelImage";
import { Notice } from "./shared";

const MAX_PHOTOS = 12;

export function PhotoManager({ hotel }: { hotel: Hotel }) {
  const { update, audit, notify, connected, command, refresh } = useApp();
  const photos = hotelPhotos(hotel);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [error, setError] = useState("");
  const [captions, setCaptions] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const p of photos) next[p.id] = p.caption;
    setCaptions(next);
  }, [hotel.id, JSON.stringify(photos.map((p) => [p.id, p.caption]))]);

  const mutateLocalPhotos = (
    nextPhotos: HotelPhoto[],
    action: string,
    detail: string,
  ) => {
    const cover = nextPhotos[0]?.url || "";
    update((current) => ({
      ...current,
      hotels: current.hotels.map((h) =>
        h.id === hotel.id ? { ...h, photos: nextPhotos, image: cover } : h,
      ),
    }));
    audit(action, hotel.id, detail);
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || busy) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      setError(`每家酒店最多保留 ${MAX_PHOTOS} 张照片，请先删除不需要的图片。`);
      return;
    }
    const chosen = Array.from(fileList).slice(0, remaining);
    if (fileList.length > remaining) {
      notify(`最多还可添加 ${remaining} 张照片，已自动截取前 ${remaining} 张。`, "warning");
    }
    setBusy(true);
    setError("");
    try {
      if (connected) {
        for (const file of chosen) {
          const blob = await compressImageForUpload(file, {
            maxDimension: 1600,
            maxBytes: 1_100_000,
            quality: 0.84,
          });
          const caption = file.name.replace(/\.[^.]+$/, "").slice(0, 80);
          await api.uploadPhoto(hotel.id, blob, file.name || "photo.jpg", caption);
        }
        await refresh();
      } else {
        const added: HotelPhoto[] = [];
        for (let i = 0; i < chosen.length; i++) {
          const file = chosen[i];
          const blob = await compressImageForUpload(file, {
            maxDimension: 960,
            maxBytes: 240_000,
            quality: 0.72,
          });
          const url = await blobToDataUrl(blob);
          added.push({
            id: `P${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
            url,
            caption: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || hotel.name,
          });
        }
        mutateLocalPhotos(
          [...photos, ...added],
          "上传酒店图片",
          `新增 ${added.length} 张酒店实景照片`,
        );
      }
      notify(`已上传 ${chosen.length} 张照片。`);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : errorMessage(cause);
      setError(msg);
      notify(msg, "error");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const addPreset = async (preset: PresetPhoto) => {
    if (busy) return;
    if (photos.length >= MAX_PHOTOS) {
      setError(`每家酒店最多保留 ${MAX_PHOTOS} 张照片。`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (connected) {
        await command({
          action: "photo_add_preset",
          hotel: hotel.id,
          photoUrl: preset.url,
          note: preset.caption,
        });
      } else {
        const nextPhoto: HotelPhoto = {
          id: `P${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          url: preset.url,
          caption: preset.caption,
        };
        mutateLocalPhotos(
          [...photos, nextPhoto],
          "添加酒店示例图片",
          `从图库选用「${preset.title}」`,
        );
      }
      setPresetOpen(false);
      notify(`已将「${preset.title}」加入酒店相册。`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (nextPhotos: HotelPhoto[], noticeText: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (connected) {
        await command({
          action: "photo_reorder",
          hotel: hotel.id,
          photoOrder: nextPhotos.map((p) => p.id),
        });
      } else {
        mutateLocalPhotos(nextPhotos, "调整酒店图片顺序", noticeText);
      }
      notify(noticeText);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveCaption = async (photo: HotelPhoto) => {
    const nextCaption = (captions[photo.id] ?? photo.caption).trim();
    if (nextCaption === photo.caption || busy) return;
    setBusy(true);
    setError("");
    try {
      if (connected) {
        await command({
          action: "photo_caption",
          hotel: hotel.id,
          id: photo.id,
          note: nextCaption,
        });
      } else {
        mutateLocalPhotos(
          photos.map((p) =>
            p.id === photo.id ? { ...p, caption: nextCaption } : p,
          ),
          "编辑酒店图片说明",
          `更新图片 ${photo.id} 说明`,
        );
      }
      notify("图片说明已更新。");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = async (photo: HotelPhoto) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (connected) {
        await command({
          action: "photo_delete",
          hotel: hotel.id,
          id: photo.id,
        });
      } else {
        mutateLocalPhotos(
          photos.filter((p) => p.id !== photo.id),
          "删除酒店图片",
          `移除图片 ${photo.id}`,
        );
      }
      notify("照片已从酒店相册移除。");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section span-2 photo-manager" aria-label="酒店相册管理">
      <div className="section-label">
        <div>
          <Text as="h2" size={500} weight="semibold">
            酒店相册
          </Text>
          <Text size={200} className="muted">
            已添加 {photos.length} / {MAX_PHOTOS} 张 · 第 1 张将作为探索页与订单列表封面
          </Text>
        </div>
        <div className="button-row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="visually-hidden"
            aria-label="选择酒店图片文件"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <Button
            appearance="primary"
            icon={busy ? <Spinner size="tiny" /> : <ArrowUpload20Regular />}
            disabled={busy || photos.length >= MAX_PHOTOS}
            onClick={() => fileInputRef.current?.click()}
          >
            上传本地照片
          </Button>
          <Button
            icon={<ImageAdd20Regular />}
            disabled={busy || photos.length >= MAX_PHOTOS}
            onClick={() => {
              setError("");
              setPresetOpen(true);
            }}
          >
            从示例图库选取
          </Button>
        </div>
      </div>

      <div
        className={`photo-dropzone ${dragOver ? "is-drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <Text size={200} className="muted">
          支持拖拽或点击上传 JPG、PNG、WebP 照片；客户端将自动等比压缩后再提交保存。
        </Text>
      </div>

      {error && (
        <div className="space-top">
          <Notice intent="error">{error}</Notice>
        </div>
      )}

      {photos.length ? (
        <div className="photo-manager-grid space-top">
          {photos.map((photo, index) => {
            const draftCaption = captions[photo.id] ?? photo.caption;
            const captionChanged = draftCaption.trim() !== photo.caption;
            return (
              <article
                className={`photo-manager-card ${index === 0 ? "is-cover" : ""}`}
                key={photo.id}
              >
                <div className="photo-manager-thumb">
                  <HotelImage
                    src={photo.url}
                    alt={photo.caption || `${hotel.name} 相册图片 ${index + 1}`}
                    hotelName={hotel.name}
                  />
                  <div className="photo-manager-badges">
                    {index === 0 ? (
                      <Badge
                        appearance="filled"
                        color="brand"
                        icon={<Star16Filled />}
                      >
                        封面
                      </Badge>
                    ) : (
                      <Badge appearance="tint" color="subtle">
                        第 {index + 1} 张
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="photo-manager-body">
                  <div className="photo-caption-row">
                    <Input
                      value={draftCaption}
                      maxLength={80}
                      aria-label={`第 ${index + 1} 张图片说明`}
                      placeholder="输入图片说明（例如：庭院大床房窗景）"
                      onChange={(_, d) =>
                        setCaptions((prev) => ({ ...prev, [photo.id]: d.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveCaption(photo);
                        }
                      }}
                      onBlur={() => {
                        if (captionChanged) void saveCaption(photo);
                      }}
                    />
                    {captionChanged && (
                      <Button
                        size="small"
                        appearance="primary"
                        icon={<Checkmark20Regular />}
                        aria-label={`保存第 ${index + 1} 张图片说明`}
                        disabled={busy}
                        onClick={() => void saveCaption(photo)}
                      >
                        保存
                      </Button>
                    )}
                  </div>
                  <div className="photo-manager-actions">
                    {index > 0 && (
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<Star16Regular />}
                        disabled={busy}
                        onClick={() => {
                          const next = [
                            photo,
                            ...photos.filter((p) => p.id !== photo.id),
                          ];
                          void reorder(next, "已将选定照片设为酒店封面。");
                        }}
                      >
                        设为封面
                      </Button>
                    )}
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<ArrowUp16Regular />}
                      aria-label={`将第 ${index + 1} 张照片前移`}
                      disabled={busy || index === 0}
                      onClick={() => {
                        const next = [...photos];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        void reorder(next, "已调整相册图片顺序。");
                      }}
                    >
                      前移
                    </Button>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<ArrowDown16Regular />}
                      aria-label={`将第 ${index + 1} 张照片后移`}
                      disabled={busy || index === photos.length - 1}
                      onClick={() => {
                        const next = [...photos];
                        [next[index + 1], next[index]] = [
                          next[index],
                          next[index + 1],
                        ];
                        void reorder(next, "已调整相册图片顺序。");
                      }}
                    >
                      后移
                    </Button>
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<Delete16Regular />}
                      aria-label={`删除第 ${index + 1} 张照片`}
                      disabled={busy}
                      onClick={() => void removePhoto(photo)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="photo-empty-box space-top">
          <HotelImage
            alt={`${hotel.name} 暂无实景照片`}
            hotelName={hotel.name}
            district="暂未添加酒店照片"
            className="photo-empty-preview"
          />
          <div>
            <Text weight="semibold">尚未上传酒店照片</Text>
            <p className="muted space-top">
              顾客端浏览酒店和查看详情时将显示建筑占位卡。上传本地照片或从示例图库选取后即可即时生效。
            </p>
          </div>
        </div>
      )}

      <Dialog
        open={presetOpen}
        onOpenChange={(_, d) => {
          if (!d.open && !busy) setPresetOpen(false);
        }}
      >
        <DialogSurface className="wide-dialog">
          <DialogBody>
            <DialogTitle>从内置示例图库选取</DialogTitle>
            <DialogContent>
              <p className="muted">
                选择一组演示实景加入当前酒店相册；添加后仍可设为封面、补充说明或删除。
              </p>
              <div className="preset-gallery-grid space-top">
                {PRESET_PHOTOS.map((preset) => {
                  const used = photos.some((p) => p.url === preset.url);
                  return (
                    <article className="preset-card" key={preset.id}>
                      <img src={preset.url} alt={preset.caption} />
                      <div className="preset-card-body">
                        <div className="inline">
                          <Text weight="semibold">{preset.title}</Text>
                          {used && (
                            <Badge appearance="tint" color="subtle">
                              已在相册中
                            </Badge>
                          )}
                        </div>
                        <Text size={200} className="muted">
                          {preset.caption}
                        </Text>
                        <Button
                          appearance={used ? "secondary" : "primary"}
                          size="small"
                          disabled={busy || photos.length >= MAX_PHOTOS}
                          onClick={() => void addPreset(preset)}
                        >
                          加入相册
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={() => setPresetOpen(false)}>
                关闭
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
