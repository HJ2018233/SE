export type PresetPhoto = {
  id: string;
  url: string;
  title: string;
  caption: string;
};

export const PRESET_PHOTOS: PresetPhoto[] = [
  {
    id: "preset-courtyard",
    url: "/images/courtyard-room.png",
    title: "庭院大床房",
    caption: "庭院大床房 · 晨光木韵",
  },
  {
    id: "preset-lake",
    url: "/images/lake-room.png",
    title: "湖景客房",
    caption: "湖景客房 · 宽窗茶席",
  },
  {
    id: "preset-entrance",
    url: "/images/garden-entrance.png",
    title: "庭院入口",
    caption: "中式庭院入口 · 灰砖绿植",
  },
];

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法读取该图片，请更换文件后重试"));
    img.src = src;
  });
}

function renderScaledJpeg(
  img: HTMLImageElement,
  maxDimension: number,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const naturalWidth = Math.max(1, img.naturalWidth || img.width);
    const naturalHeight = Math.max(1, img.naturalHeight || img.height);
    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("当前环境不支持图片压缩"));
      return;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("图片编码失败，请重试"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

export async function compressImageForUpload(
  file: File,
  options?: { maxDimension?: number; maxBytes?: number; quality?: number },
): Promise<Blob> {
  if (!ACCEPTED_TYPES.has(file.type) && !ACCEPTED_EXT.test(file.name)) {
    throw new Error("仅支持 JPG、PNG 或 WebP 格式的图片文件");
  }
  const maxDimension = options?.maxDimension ?? 1600;
  const maxBytes = options?.maxBytes ?? 1_100_000;
  const quality = options?.quality ?? 0.84;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    let blob = await renderScaledJpeg(img, maxDimension, quality);
    if (blob.size > maxBytes) {
      blob = await renderScaledJpeg(
        img,
        Math.min(maxDimension, 1280),
        Math.min(quality, 0.72),
      );
    }
    if (blob.size > 1_900_000) {
      blob = await renderScaledJpeg(img, 960, 0.62);
    }
    if (blob.size > 2 * 1024 * 1024) {
      throw new Error("压缩后图片仍超过 2 MB，请裁剪或更换较小的照片");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("读取图片数据失败"));
    };
    reader.onerror = () => reject(new Error("读取图片数据失败"));
    reader.readAsDataURL(blob);
  });
}
