import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalShellProps {
  onClose: () => void;
  closeDisabled?: boolean;
  maxWidthClass?: string;
  zIndexClass?: string;
  alignTop?: boolean;
  flexColumn?: boolean;
  role?: 'dialog' | 'alertdialog';
  ariaLabelledBy?: string;
  children: React.ReactNode;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  onClose,
  closeDisabled = false,
  maxWidthClass = 'max-w-md',
  zIndexClass = 'z-50',
  alignTop = false,
  flexColumn = false,
  role = 'dialog',
  ariaLabelledBy,
  children,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeDisabled) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDisabled, onClose]);

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} bg-black/60 backdrop-blur-sm flex ${
        alignTop ? 'items-start pt-16' : 'items-center'
      } justify-center p-4`}
      onClick={() => !closeDisabled && onClose()}
    >
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        className={`bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 w-full ${maxWidthClass} ${
          flexColumn ? 'max-h-[90vh] flex flex-col' : ''
        } rounded-3xl shadow-2xl overflow-hidden pop-in`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

interface ModalCloseButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export const ModalCloseButton: React.FC<ModalCloseButtonProps> = ({ onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label="Đóng"
    className="w-8 h-8 flex-shrink-0 rounded-full bg-stone-200 dark:bg-slate-700 hover:bg-stone-300 dark:hover:bg-slate-600 text-gray-600 dark:text-slate-300 flex items-center justify-center transition disabled:opacity-40"
  >
    <X className="w-4 h-4" />
  </button>
);

interface ErrorBannerProps {
  message: string | null | undefined;
  className?: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, className = '' }) => {
  if (!message) return null;
  return (
    <div
      className={`p-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 ${className}`}
    >
      {message}
    </div>
  );
};
