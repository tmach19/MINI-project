import React from 'react';
import { parseLocationRoute } from '../../languages/config';
import type { LanguageCode } from '../../types';

interface LoadingStateProps {
  message?: string;
  subMessage?: string;
  compact?: boolean;
  lang?: LanguageCode;
}

function isEnglishMode(lang?: LanguageCode): boolean {
  if (lang) return lang === 'en';
  return parseLocationRoute().lang === 'en';
}

export const LoadingSpinner: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  lang?: LanguageCode;
}> = ({ size = 'md', lang }) => {
  const isEnglish = isEnglishMode(lang);
  const sizeMap = {
    sm: 'w-6 h-6',
    md: 'w-11 h-11',
    lg: 'w-14 h-14',
  };

  return (
    <div className="relative inline-flex items-center justify-center" role="status" aria-label="Đang tải">
      <svg className={`${sizeMap[size]} animate-spin`} viewBox="0 0 48 48" fill="none">
        <circle
          cx="24"
          cy="24"
          r="20"
          className="stroke-stone-200 dark:stroke-slate-700"
          strokeWidth="4"
        />
        <path
          d="M24 4 A20 20 0 0 1 44 24"
          stroke={isEnglish ? '#4f46e5' : '#dc2626'}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M44 24 A20 20 0 0 1 24 44"
          stroke={isEnglish ? '#0ea5e9' : '#f59e0b'}
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
};

export const LoadingScreen: React.FC<{ lang?: LanguageCode }> = ({ lang }) => {
  const isEnglish = isEnglishMode(lang);

  if (isEnglish) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50 dark:bg-slate-950">
        <div
          className="relative flex items-center justify-center pop-in"
          role="status"
          aria-label="Đang tải"
        >
          <div className="absolute w-24 h-24 rounded-full bg-indigo-500/15 dark:bg-indigo-500/20 blur-xl" />
          <svg className="w-20 h-20 animate-spin relative" viewBox="0 0 80 80" fill="none">
            <circle
              cx="40"
              cy="40"
              r="35"
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth="4.5"
            />
            <path
              d="M40 5 A35 35 0 0 1 75 40"
              stroke="#4f46e5"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
            <path
              d="M75 40 A35 35 0 0 1 40 75"
              stroke="#0ea5e9"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-sky-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
            <span className="font-black tracking-tight text-lg">EN</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-stone-50 dark:bg-slate-950">
      <div className="relative flex items-center justify-center pop-in" role="status" aria-label="Đang tải">
        <svg className="w-20 h-20 animate-spin" viewBox="0 0 80 80" fill="none">
          <circle
            cx="40"
            cy="40"
            r="35"
            className="stroke-stone-200 dark:stroke-slate-800"
            strokeWidth="4.5"
          />
          <path
            d="M40 5 A35 35 0 0 1 75 40"
            stroke="#dc2626"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path
            d="M75 40 A35 35 0 0 1 40 75"
            stroke="#f59e0b"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
        </svg>
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
  lang,
}) => {
  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 text-center flex flex-col items-center justify-center space-y-3 ${
        compact ? 'py-10 px-6' : 'p-16'
      }`}
    >
      <LoadingSpinner size={compact ? 'sm' : 'md'} lang={lang} />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">{message}</p>
        {subMessage && <p className="text-xs text-gray-500 dark:text-slate-400">{subMessage}</p>}
      </div>
    </div>
  );
};
