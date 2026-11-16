import React, { useState } from 'react';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  Flag,
  LogOut,
  Mail,
  Shield,
  Sliders,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';
import type { LessonSummary, MarkedVocabRecord, TestAttemptRecord, UserProfile } from '../types';

type ProfileTab = 'overview' | 'saved_vocab' | 'test_history' | 'settings';

interface ProfilePageProps {
  user: UserProfile;
  dbMode: 'postgres' | 'memory' | null;
  lessons: LessonSummary[];
  markedMap: Record<string, MarkedVocabRecord>;
  attempts: TestAttemptRecord[];
  onBackToStudy: () => void;
  onLogout: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  user,
  dbMode,
  lessons,
  markedMap,
  attempts,
  onBackToStudy,
  onLogout,
}) => {
  const [profileTab, setProfileTab] = useState<ProfileTab>('overview');

  const markedCount = Object.keys(markedMap).length;
  const customLessonCount = lessons.filter((l) => !l.isSystem).length;
  const joinedDate = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';

  const tabs: ReadonlyArray<{ id: ProfileTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Thông tin chung', icon: UserIcon },
    { id: 'saved_vocab', label: 'Từ đã đánh dấu', icon: Flag },
    { id: 'test_history', label: 'Lịch sử làm bài', icon: Award },
    { id: 'settings', label: 'Thiết lập tài khoản', icon: Sliders },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pop-in">
      {/* Thanh điều hướng quay lại */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToStudy}
          className="px-3.5 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-stone-100 dark:hover:bg-slate-800 text-xs font-bold text-gray-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Quay lại buổi học
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="px-3.5 py-2 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-xs font-bold text-red-600 dark:text-red-300 inline-flex items-center gap-1.5 transition"
        >
          <LogOut className="w-3.5 h-3.5" /> Đăng xuất
        </button>
      </div>

      {/* Header Profile Card */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-red-600 via-rose-600 to-amber-500 relative">
          <div className="absolute inset-0 opacity-15 bg-[radial-gradient(circle_at_top_right,#fff,transparent_60%)]" />
        </div>

        <div className="px-6 pb-6 -mt-12 flex flex-col sm:flex-row sm:items-end justify-between gap-4 relative">
          <div className="flex items-end gap-4">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-950 dark:from-red-600 dark:to-amber-600 border-4 border-white dark:border-slate-900 shadow-lg flex items-center justify-center text-white text-2xl font-black tracking-wide">
              {getInitials(user.displayName)}
            </div>
            <div className="pb-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">
                  {user.displayName}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  {user.role === 'admin' ? 'Quản trị viên' : 'Học viên'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> {user.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
            <span className="px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-slate-800 font-medium inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-red-500" /> Tham gia: {joinedDate}
            </span>
            <span className="px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-slate-800 font-mono text-[11px] font-bold">
              {dbMode === 'postgres' ? 'PostgreSQL' : 'Dev Mode'}
            </span>
          </div>
        </div>
      </div>

      {/* Thống kê tổng quan từ state sẵn có */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
            <Flag className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{markedCount}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Từ đang đánh dấu</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center flex-shrink-0">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{attempts.length}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Lượt làm bài kiểm tra</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{customLessonCount}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Buổi học tự tạo</p>
          </div>
        </div>
      </div>

      {/* Khung tab sẵn sàng để mở rộng chức năng sau */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-800/40 flex items-center gap-2 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = profileTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setProfileTab(id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap inline-flex items-center gap-1.5 transition ${
                  active
                    ? 'bg-red-600 text-white shadow-sm'
                    : 'text-gray-600 dark:text-slate-300 hover:bg-stone-200/70 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          {profileTab === 'overview' ? (
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Thông tin tài khoản</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block mb-0.5">Tên hiển thị</span>
                  <span className="font-bold text-gray-900 dark:text-white">{user.displayName}</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block mb-0.5">Email đăng nhập</span>
                  <span className="font-bold text-gray-900 dark:text-white">{user.email}</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block mb-0.5">Vai trò</span>
                  <span className="font-bold text-gray-900 dark:text-white uppercase font-mono">{user.role}</span>
                </div>
                <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-slate-400 block mb-0.5">ID tài khoản</span>
                  <span className="font-mono text-[11px] text-gray-700 dark:text-slate-300 break-all">{user.id}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center space-y-2">
              <div className="w-11 h-11 rounded-2xl bg-stone-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 mx-auto flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                {tabs.find((t) => t.id === profileTab)?.label}
              </h3>
              <p className="text-xs text-gray-500 dark:text-slate-400 max-w-md mx-auto">
                Khu vực này đã dựng sẵn khung giao diện để bạn thiết kế và gắn thêm chức năng chi tiết sau.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
