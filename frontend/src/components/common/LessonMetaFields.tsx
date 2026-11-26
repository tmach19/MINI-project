import React from 'react';
import { CEFR_LEVELS, HSK_LEVELS } from '../../lib/constants';
import type { LanguageCode } from '../../types';

interface LessonMetaFieldsProps {
  lang?: LanguageCode;
  title: string;
  hskLevel: string;
  description: string;
  onChangeTitle: (value: string) => void;
  onChangeLevel: (value: string) => void;
  onChangeDescription: (value: string) => void;
  titleRequired?: boolean;
  compact?: boolean;
}

export const LessonMetaFields: React.FC<LessonMetaFieldsProps> = ({
  lang = 'zh',
  title,
  hskLevel,
  description,
  onChangeTitle,
  onChangeLevel,
  onChangeDescription,
  titleRequired = false,
  compact = false,
}) => {
  const levelOptions = lang === 'en' ? CEFR_LEVELS : HSK_LEVELS;
  const inputPad = compact ? 'p-2' : 'p-2.5';
  const labelCls = compact
    ? 'text-[11px] font-bold text-gray-700 dark:text-slate-300 block mb-1'
    : 'text-xs font-bold text-gray-700 dark:text-slate-300 block mb-1';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label className={labelCls}>Tên buổi học (*)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => onChangeTitle(e.target.value)}
            required={titleRequired}
            placeholder={
              lang === 'en'
                ? 'Ví dụ: Bài ôn tập 1: Giao tiếp tại quán cà phê'
                : 'Ví dụ: Buổi ôn tập 1: Gọi món nhà hàng'
            }
            className={`w-full ${inputPad} text-xs rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white font-semibold`}
          />
        </div>
        <div>
          <label className={labelCls}>Cấp độ</label>
          <select
            value={hskLevel}
            onChange={(e) => onChangeLevel(e.target.value)}
            className={`w-full ${inputPad} text-xs rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white font-semibold`}
          >
            {levelOptions.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Mô tả tóm tắt</label>
        <input
          type="text"
          value={description}
          onChange={(e) => onChangeDescription(e.target.value)}
          placeholder="Tóm tắt trọng tâm buổi học..."
          className={`w-full ${inputPad} text-xs rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white`}
        />
      </div>
    </div>
  );
};
