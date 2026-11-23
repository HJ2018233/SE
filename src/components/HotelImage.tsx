import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Building24Regular } from "@fluentui/react-icons";
import { resolveAssetUrl } from "../api";

export function HotelImage({
  src,
  alt,
  hotelName,
  district,
  className,
  loading,
  fetchPriority,
  style,
}: {
  src?: string;
  alt: string;
  hotelName?: string;
  district?: string;
  className?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  style?: CSSProperties;
}) {
  const resolved = resolveAssetUrl(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  if (!resolved || failed) {
    return (
      <div
        className={`hotel-image-placeholder ${className || ""}`.trim()}
        style={style}
        role="img"
        aria-label={alt}
      >
        <div className="hotel-image-placeholder-frame" aria-hidden="true">
          <span className="hotel-image-placeholder-icon">
            <Building24Regular />
          </span>
          {hotelName && (
            <strong className="hotel-image-placeholder-title">{hotelName}</strong>
          )}
          <span className="hotel-image-placeholder-sub">
            {district || "暂无实景照片"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className={className}
      loading={loading}
      fetchPriority={fetchPriority}
      style={style}
      onError={() => setFailed(true)}
    />
  );
}
