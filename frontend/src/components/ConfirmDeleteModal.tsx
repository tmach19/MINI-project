import React, { useEffect } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { ErrorBanner, ModalCloseButton, ModalShell } from './common/ModalShell';

interface ConfirmDeleteModalProps {
  title: string;
  /** Tên đối tượng bị xoá, hiển thị nổi bật trong nội dung */
  itemName: string;
  description?: string;
  confirmLabel?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  title,
  itemName,
  description,
  confirmLabel = 'Xoá',
  loading = false,
  error,
  onConfirm,
  onCancel,
}) => {
  // Enter để xác nhận nhanh (Esc đã được ModalShell xử lý)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!loading && e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loading, onConfirm]);

  return (
    <ModalShell
      onClose={onCancel}
      closeDisabled={loading}
      zIndexClass="z-[60]"
      role="alertdialog"
      ariaLabelledBy="confirm-delete-title"
    >
      <div className="p-5 flex items-start gap-4">
        <div className="w-11 h-11 flex-shrink-0 rounded-2xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-grow min-w-0 space-y-1.5">
          <h3 id="confirm-delete-title" className="text-base font-bold text-gray-900 dark:text-white">
            {title}
          </h3>
          <p className="text-sm text-gray-600 dark:text-slate-300">
            Bạn có chắc muốn xoá{' '}
            <strong className="text-gray-900 dark:text-white break-words">“{itemName}”</strong>?
          </p>
          {description && (
            <p className="text-xs text-gray-500 dark:text-slate-400">{description}</p>
          )}
        </div>
        <ModalCloseButton onClick={onCancel} disabled={loading} />
      </div>

      <ErrorBanner message={error} className="mx-5 mb-3" />

      <div className="px-5 py-4 bg-stone-50 dark:bg-slate-800/60 border-t border-stone-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-stone-100 dark:hover:bg-slate-800 text-xs font-bold text-gray-700 dark:text-slate-200 transition disabled:opacity-40"
        >
          Huỷ
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          autoFocus
          className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md transition disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          {loading ? 'Đang xoá...' : confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
};
