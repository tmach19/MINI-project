import React, { useRef, useState } from 'react';
import { Check, Image as ImageIcon, Link2, RotateCcw, Upload } from 'lucide-react';
import {
  compressImageFileToDataUrl,
  getAvatarPreset,
  getCoverPreset,
  isImageMediaUrl,
  PROFILE_AVATAR_PRESETS,
  PROFILE_COVER_PRESETS,
} from '../lib/profileMedia';
import { LoadingSpinner } from './common/LoadingState';
import { ErrorBanner, ModalCloseButton, ModalShell } from './common/ModalShell';

interface ProfileMediaModalProps {
  mode: 'avatar' | 'cover';
  currentValue?: string | null;
  initials: string;
  onClose: () => void;
  onSave: (nextValue: string | null) => Promise<void>;
}

export const ProfileMediaModal: React.FC<ProfileMediaModalProps> = ({
  mode,
  currentValue,
  initials,
  onClose,
  onSave,
}) => {
  const isAvatar = mode === 'avatar';
  const [draft, setDraft] = useState<string | null>(currentValue ?? null);
  const [urlInput, setUrlInput] = useState(() =>
    currentValue && /^https?:\/\//i.test(currentValue) ? currentValue : ''
  );
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setProcessing(true);
    setError(null);
    try {
      const dataUrl = await compressImageFileToDataUrl(
        file,
        isAvatar ? 256 : 1200,
        isAvatar ? 256 : 360
      );
      setDraft(dataUrl);
      setUrlInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xử lý được ảnh tải lên.');
    } finally {
      setProcessing(false);
    }
  };

  const handleApplyUrl = () => {
    const clean = urlInput.trim();
    if (!clean) {
      setError('Vui lòng nhập đường dẫn URL ảnh.');
      return;
    }
    if (!/^https?:\/\//i.test(clean)) {
      setError('URL ảnh phải bắt đầu bằng http:// hoặc https://');
      return;
    }
    setError(null);
    setDraft(clean);
  };

  const handleConfirmSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được thay đổi.');
    } finally {
      setSaving(false);
    }
  };

  const previewAvatarPreset = isAvatar ? getAvatarPreset(draft) : null;
  const previewCoverPreset = !isAvatar ? getCoverPreset(draft) : null;

  return (
    <ModalShell onClose={onClose} maxWidthClass="max-w-lg">
      <div className="px-6 py-4 bg-stone-50 dark:bg-slate-800/70 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center">
            <ImageIcon className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              {isAvatar ? 'Chọn ảnh đại diện' : 'Chọn ảnh nền hồ sơ'}
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">
              {isAvatar
                ? 'Tải ảnh từ máy, chọn biểu tượng hoặc dùng đường dẫn ảnh.'
                : 'Tải ảnh ngang từ máy, chọn mẫu nền hoặc dùng đường dẫn ảnh.'}
            </p>
          </div>
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>

      <div className="p-6 space-y-5 overflow-y-auto">
        <ErrorBanner message={error} />

        {/* Live Preview */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 block">
            Xem trước
          </span>
          {isAvatar ? (
            <div className="flex items-center justify-center p-4 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/80 dark:border-slate-800">
              <div className="w-24 h-24 rounded-3xl overflow-hidden border-4 border-white dark:border-slate-900 shadow-lg flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 dark:from-red-600 dark:to-amber-600 text-white text-2xl font-black">
                {isImageMediaUrl(draft) ? (
                  <img src={draft!} alt="Avatar preview" className="w-full h-full object-cover" />
                ) : previewAvatarPreset ? (
                  <div
                    className={`w-full h-full ${previewAvatarPreset.gradientClass} flex items-center justify-center chinese-serif text-4xl font-black text-white`}
                  >
                    {previewAvatarPreset.symbol}
                  </div>
                ) : (
                  <span>{initials}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="h-32 w-full rounded-2xl overflow-hidden border border-stone-200 dark:border-slate-700 shadow-inner relative">
              {isImageMediaUrl(draft) ? (
                <img src={draft!} alt="Cover preview" className="w-full h-full object-cover" />
              ) : (
                <div className={`w-full h-full ${previewCoverPreset?.gradientClass}`} />
              )}
            </div>
          )}
        </div>

        {/* Upload from device */}
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => void handleFileChange(e)}
            className="hidden"
          />
          <button
            type="button"
            disabled={processing || saving}
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-stone-300 dark:border-slate-700 hover:border-red-400 dark:hover:border-red-500 bg-stone-50/70 dark:bg-slate-800/40 text-xs font-bold text-gray-700 dark:text-slate-200 flex items-center justify-center gap-2 transition"
          >
            {processing ? (
              <>
                <LoadingSpinner size="sm" /> Đang xử lý ảnh...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 text-red-600 dark:text-red-400" />
                Tải ảnh từ thiết bị
              </>
            )}
          </button>
        </div>

        {/* Presets */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 block">
            Mẫu có sẵn
          </span>
          {isAvatar ? (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
              {PROFILE_AVATAR_PRESETS.map((preset) => {
                const selected = draft === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setDraft(preset.id);
                      setUrlInput('');
                      setError(null);
                    }}
                    className={`p-1.5 rounded-2xl border flex flex-col items-center gap-1 transition ${
                      selected
                        ? 'border-red-500 ring-2 ring-red-500/30 bg-red-50/50 dark:bg-red-950/30'
                        : 'border-stone-200 dark:border-slate-700 hover:border-red-300'
                    }`}
                  >
                    <div
                      className={`w-11 h-11 rounded-xl ${preset.gradientClass} flex items-center justify-center chinese-serif text-xl font-black text-white shadow-sm`}
                    >
                      {preset.symbol}
                    </div>
                    <span className="text-[10px] font-semibold text-gray-600 dark:text-slate-300 truncate max-w-full">
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {PROFILE_COVER_PRESETS.map((preset) => {
                const selected = draft === preset.id || (!draft && preset.id === PROFILE_COVER_PRESETS[0].id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setDraft(preset.id);
                      setUrlInput('');
                      setError(null);
                    }}
                    className={`rounded-2xl overflow-hidden border text-left transition ${
                      selected
                        ? 'border-red-500 ring-2 ring-red-500/30'
                        : 'border-stone-200 dark:border-slate-700 hover:border-red-300'
                    }`}
                  >
                    <div className={`h-12 w-full ${preset.gradientClass}`} />
                    <div className="px-2.5 py-1.5 bg-white dark:bg-slate-900 text-[11px] font-semibold text-gray-700 dark:text-slate-200 truncate">
                      {preset.label}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Direct Image URL */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 block">
            Hoặc dán URL ảnh
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Link2 className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApplyUrl();
                  }
                }}
                placeholder="https://example.com/image.jpg"
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-red-500"
              />
            </div>
            <button
              type="button"
              onClick={handleApplyUrl}
              className="px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-stone-100 dark:hover:bg-slate-700 text-xs font-semibold text-gray-700 dark:text-slate-200 transition"
            >
              Xem thử
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 bg-stone-50 dark:bg-slate-800/60 border-t border-stone-200 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          disabled={saving || draft === null}
          onClick={() => {
            setDraft(null);
            setUrlInput('');
            setError(null);
          }}
          className="px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 text-xs font-semibold text-gray-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1.5 transition"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Mặc định
        </button>

        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-stone-200 dark:border-slate-700 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800 transition"
          >
            Huỷ
          </button>
          <button
            type="button"
            disabled={saving || processing}
            onClick={() => void handleConfirmSave()}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition"
          >
            {saving ? <LoadingSpinner size="sm" /> : <Check className="w-3.5 h-3.5" />}
            Lưu thay đổi
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
