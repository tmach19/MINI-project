import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical, Sparkles } from 'lucide-react';

export interface ExtensionMenuItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

interface HeaderExtensionMenuProps {
  items?: ExtensionMenuItem[];
}

export const HeaderExtensionMenu: React.FC<HeaderExtensionMenuProps> = ({ items = [] }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Mở rộng chức năng"
        className={`p-2 rounded-xl border transition active:scale-95 ${
          open
            ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300'
            : 'border-stone-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800'
        }`}
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-2xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden z-50 pop-in"
        >
          <div className="px-3.5 py-2.5 border-b border-stone-100 dark:border-slate-800 bg-stone-50/80 dark:bg-slate-800/50 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-red-500" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              Tiện ích mở rộng
            </span>
          </div>

          {items.length > 0 ? (
            <div className="p-1.5 space-y-0.5 max-h-[70vh] overflow-y-auto">
              {items.map((item) => {
                const Icon = item.icon;
                const isSelected = Boolean(item.active);
                const isDisabled = Boolean(item.disabled || isSelected);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    aria-current={isSelected ? 'page' : undefined}
                    disabled={isDisabled}
                    onClick={() => {
                      if (isDisabled) return;
                      setOpen(false);
                      item.onClick();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl border flex items-start gap-2.5 transition ${
                      isSelected
                        ? 'bg-red-50 dark:bg-red-900/35 border-red-300 dark:border-red-700/80 cursor-default shadow-sm'
                        : 'border-transparent hover:bg-stone-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                        isSelected ? 'text-red-600 dark:text-red-400' : item.iconClassName || ''
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <span
                        className={`block text-xs font-semibold ${
                          isSelected
                            ? 'text-red-700 dark:text-red-200'
                            : 'text-gray-800 dark:text-slate-100'
                        }`}
                      >
                        {item.label}
                      </span>
                      {item.description && (
                        <span
                          className={`block text-[11px] truncate ${
                            isSelected
                              ? 'text-red-600/80 dark:text-red-300/80'
                              : 'text-gray-500 dark:text-slate-400'
                          }`}
                        >
                          {item.description}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <span
                        className="mt-1.5 w-2 h-2 rounded-full bg-red-500 flex-shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-xs text-gray-500 dark:text-slate-400">
              Chưa có chức năng mở rộng nào — sẵn sàng để bổ sung sau.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
