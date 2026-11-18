export interface CoverPreset {
  id: string;
  label: string;
  gradientClass: string;
}

export interface AvatarPreset {
  id: string;
  label: string;
  symbol: string;
  gradientClass: string;
}

export const PROFILE_COVER_PRESETS: CoverPreset[] = [
  {
    id: 'preset:sunset-crimson',
    label: 'Hán Ngữ Đỏ Cam',
    gradientClass: 'bg-gradient-to-r from-red-600 via-rose-600 to-amber-500',
  },
  {
    id: 'preset:shanghai-night',
    label: 'Đêm Thượng Hải',
    gradientClass: 'bg-gradient-to-r from-slate-900 via-indigo-900 to-cyan-700',
  },
  {
    id: 'preset:bamboo-jade',
    label: 'Rừng Trúc Xanh',
    gradientClass: 'bg-gradient-to-r from-emerald-700 via-teal-600 to-lime-500',
  },
  {
    id: 'preset:imperial-gold',
    label: 'Hoàng Thành Kim',
    gradientClass: 'bg-gradient-to-r from-amber-700 via-orange-600 to-yellow-500',
  },
  {
    id: 'preset:plum-blossom',
    label: 'Hoa Đào Xuân',
    gradientClass: 'bg-gradient-to-r from-fuchsia-700 via-pink-600 to-rose-400',
  },
  {
    id: 'preset:ink-mist',
    label: 'Thuỷ Mặc Sơn Hà',
    gradientClass: 'bg-gradient-to-r from-zinc-800 via-stone-700 to-slate-600',
  },
];

export const PROFILE_AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'preset:han',
    label: 'Hán (汉)',
    symbol: '汉',
    gradientClass: 'bg-gradient-to-br from-red-600 to-amber-600',
  },
  {
    id: 'preset:xue',
    label: 'Học (学)',
    symbol: '学',
    gradientClass: 'bg-gradient-to-br from-emerald-600 to-teal-500',
  },
  {
    id: 'preset:wen',
    label: 'Văn (文)',
    symbol: '文',
    gradientClass: 'bg-gradient-to-br from-indigo-600 to-cyan-500',
  },
  {
    id: 'preset:long',
    label: 'Long (龙)',
    symbol: '龙',
    gradientClass: 'bg-gradient-to-br from-amber-600 to-yellow-500',
  },
  {
    id: 'preset:fu',
    label: 'Phúc (福)',
    symbol: '福',
    gradientClass: 'bg-gradient-to-br from-rose-600 to-pink-500',
  },
  {
    id: 'preset:xing',
    label: 'Tinh (星)',
    symbol: '星',
    gradientClass: 'bg-gradient-to-br from-violet-600 to-purple-500',
  },
];

export function isImageMediaUrl(url?: string | null): boolean {
  if (!url) return false;
  const clean = url.trim();
  return /^data:image\//i.test(clean) || /^https?:\/\//i.test(clean);
}

export function getCoverPreset(url?: string | null): CoverPreset {
  return PROFILE_COVER_PRESETS.find((p) => p.id === url) || PROFILE_COVER_PRESETS[0];
}

export function getAvatarPreset(url?: string | null): AvatarPreset | null {
  if (!url) return null;
  return PROFILE_AVATAR_PRESETS.find((p) => p.id === url) || null;
}

/**
 * Nén và cắt (center-crop) ảnh tải từ máy về kích thước tối ưu để lưu nhanh, sắc nét.
 */
export async function compressImageFileToDataUrl(
  file: File,
  targetWidth: number,
  targetHeight: number
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Vui lòng chọn tệp hình ảnh (PNG, JPG, WebP, GIF).');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Ảnh gốc quá lớn (tối đa 10MB).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không đọc được tệp ảnh này.'));
      el.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');

    // Center crop (cover fit)
    const srcRatio = img.width / img.height;
    const dstRatio = targetWidth / targetHeight;
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;

    if (srcRatio > dstRatio) {
      sw = Math.round(img.height * dstRatio);
      sx = Math.round((img.width - sw) / 2);
    } else if (srcRatio < dstRatio) {
      sh = Math.round(img.width / dstRatio);
      sy = Math.round((img.height - sh) / 2);
    }

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

    const webp = canvas.toDataURL('image/webp', 0.84);
    if (webp.startsWith('data:image/webp')) {
      return webp;
    }
    return canvas.toDataURL('image/jpeg', 0.84);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
