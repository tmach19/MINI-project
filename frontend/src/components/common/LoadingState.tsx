import React from 'react';

interface LoadingStateProps {
  message?: string;
  subMessage?: string;
  compact?: boolean;
}

export const LoadingSpinner: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const sizeMap = {
    sm: 'w-6 h-6 border-2',
    md: 'w-11 h-11 border-[3px]',
    lg: 'w-14 h-14 border-4',
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <div
        className={`${sizeMap[size]} rounded-full border-stone-200 dark:border-slate-700 border-t-red-600 dark:border-t-red-500 border-r-amber-500 animate-spin`}
        role="status"
        aria-label="Đang tải"
      />
    </div>
  );
};

export const LoadingScreen: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-stone-50 dark:bg-slate-950">
      <div className="relative flex items-center justify-center pop-in" role="status" aria-label="Đang tải">
        <div className="w-20 h-20 rounded-full border-4 border-stone-200 dark:border-slate-800 border-t-red-600 border-r-amber-500 animate-spin" />
        <div className="absolute w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600 to-amber-600 flex items-center justify-center text-white shadow-lg">
          <span className="chinese-serif text-2xl font-black">汉</span>
        </div>
      </div>
    </div>
  );
};

export const LoadingCard: React.FC<LoadingStateProps> = ({
  message = 'Đang tải dữ liệu...',
  subMessage,
  compact = false,
}) => {
  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 text-center flex flex-col items-center justify-center space-y-3 ${
        compact ? 'py-10 px-6' : 'p-16'
      }`}
    >
      <LoadingSpinner size={compact ? 'sm' : 'md'} />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">{message}</p>
        {subMessage && <p className="text-xs text-gray-500 dark:text-slate-400">{subMessage}</p>}
      </div>
    </div>
  );
};
