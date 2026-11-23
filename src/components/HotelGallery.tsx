import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
} from "@fluentui/react-components";
import {
  ChevronLeft24Regular,
  ChevronRight24Regular,
  Dismiss24Regular,
  ZoomIn20Regular,
} from "@fluentui/react-icons";
import type { HotelPhoto } from "../model";
import { HotelImage } from "./HotelImage";

export function HotelGallery({
  photos,
  hotelName,
  district,
}: {
  photos: HotelPhoto[];
  hotelName: string;
  district?: string;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const returnTargetRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const openAt = (index: number, target?: HTMLElement | null) => {
    returnTargetRef.current =
      target ||
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setLightboxIndex(index);
  };

  const close = () => setLightboxIndex(null);

  useEffect(() => {
    const isOpen = lightboxIndex !== null;
    if (wasOpenRef.current && !isOpen) {
      requestAnimationFrame(() => {
        if (returnTargetRef.current?.isConnected) {
          returnTargetRef.current.focus();
        }
      });
    }
    wasOpenRef.current = isOpen;
  }, [lightboxIndex]);

  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex >= photos.length) {
      setLightboxIndex(photos.length ? 0 : null);
    }
  }, [lightboxIndex, photos.length]);

  if (photos.length === 0) {
    return (
      <div className="detail-gallery is-empty">
        <div className="gallery-empty-tile">
          <HotelImage
            alt={`${hotelName} 暂无实景照片`}
            hotelName={hotelName}
            district={district || "暂未上传实景照片"}
            className="gallery-empty-frame"
          />
          <Badge appearance="tint" color="subtle" className="gallery-empty-tag">
            暂无实景照片
          </Badge>
        </div>
      </div>
    );
  }

  const shown = photos.slice(0, 3);
  const layoutClass =
    shown.length === 1
      ? "is-single"
      : shown.length === 2
        ? "is-pair"
        : "is-bento";
  const extraCount = photos.length - 3;
  const activePhoto =
    lightboxIndex !== null ? photos[lightboxIndex] || photos[0] : null;

  const step = (delta: number) => {
    if (lightboxIndex === null || photos.length <= 1) return;
    setLightboxIndex((lightboxIndex + delta + photos.length) % photos.length);
  };

  return (
    <>
      <div className={`detail-gallery ${layoutClass}`}>
        {shown.map((photo, index) => {
          const isOverflowTile = index === 2 && extraCount > 0;
          return (
            <button
              key={photo.id}
              type="button"
              className={`gallery-tile ${index === 0 ? "is-main" : "is-sub"}`}
              aria-label={`查看大图：${photo.caption || hotelName}（第 ${index + 1} / ${photos.length} 张）`}
              onClick={(e) => openAt(index, e.currentTarget)}
            >
              <HotelImage
                src={photo.url}
                alt={photo.caption || `${hotelName}实景照片 ${index + 1}`}
                hotelName={hotelName}
                district={district}
                fetchPriority={index === 0 ? "high" : undefined}
              />
              {isOverflowTile ? (
                <span className="gallery-more-overlay">
                  +{extraCount + 1} 张 · 查看全部
                </span>
              ) : index === 0 ? (
                <span className="gallery-zoom-pill">
                  <ZoomIn20Regular aria-hidden="true" />
                  <span>
                    {photos.length > 1 ? `浏览全部 ${photos.length} 张` : "查看大图"}
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <Dialog
        open={lightboxIndex !== null}
        onOpenChange={(_, d) => {
          if (!d.open) close();
        }}
      >
        {activePhoto ? (
          <DialogSurface
            className="lightbox-dialog"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                step(-1);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                step(1);
              }
            }}
          >
            <DialogBody>
              <DialogTitle
                action={
                  <Button
                    appearance="subtle"
                    icon={<Dismiss24Regular />}
                    aria-label="关闭大图浏览"
                    onClick={close}
                  />
                }
              >
                <span className="lightbox-title-row">
                  <span>{hotelName}</span>
                  <Badge appearance="tint" color="brand">
                    {(lightboxIndex ?? 0) + 1} / {photos.length}
                  </Badge>
                </span>
              </DialogTitle>
              <DialogContent className="lightbox-content">
                <div className="lightbox-stage">
                  {photos.length > 1 && (
                    <Button
                      appearance="secondary"
                      shape="circular"
                      icon={<ChevronLeft24Regular />}
                      className="lightbox-nav prev"
                      aria-label="上一张照片"
                      onClick={() => step(-1)}
                    />
                  )}
                  <HotelImage
                    src={activePhoto.url}
                    alt={activePhoto.caption || hotelName}
                    hotelName={hotelName}
                    district={district}
                    className="lightbox-image"
                  />
                  {photos.length > 1 && (
                    <Button
                      appearance="secondary"
                      shape="circular"
                      icon={<ChevronRight24Regular />}
                      className="lightbox-nav next"
                      aria-label="下一张照片"
                      onClick={() => step(1)}
                    />
                  )}
                </div>
                <Text className="lightbox-caption">
                  {activePhoto.caption || `${hotelName} · 实景图片`}
                </Text>
                {photos.length > 1 && (
                  <div className="lightbox-thumbs" role="group" aria-label="切换相册照片">
                    {photos.map((photo, idx) => (
                      <button
                        key={photo.id}
                        type="button"
                        aria-label={`第 ${idx + 1} 张：${photo.caption || hotelName}`}
                        aria-pressed={idx === lightboxIndex}
                        className={`lightbox-thumb ${idx === lightboxIndex ? "active" : ""}`}
                        onClick={() => setLightboxIndex(idx)}
                      >
                        <HotelImage
                          src={photo.url}
                          alt={photo.caption || `${hotelName} 缩略图 ${idx + 1}`}
                          hotelName={hotelName}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </DialogContent>
            </DialogBody>
          </DialogSurface>
        ) : (
          <></>
        )}
      </Dialog>
    </>
  );
}
