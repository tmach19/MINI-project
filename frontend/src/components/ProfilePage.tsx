import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  Camera,
  Check,
  Edit3,
  Flag,
  LogOut,
  Mail,
  Shield,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { getAvatarPreset, getCoverPreset, isImageMediaUrl } from '../lib/profileMedia';
import { LoadingSpinner } from './common/LoadingState';
import { ProfileMediaModal } from './ProfileMediaModal';
import type {
  LessonSummary,
  MarkedVocabRecord,
  TestAttemptRecord,
  UserProfile,
} from '../types';

interface ProfilePageProps {
  user: UserProfile;
  lessons: LessonSummary[];
  markedMap: Record<string, MarkedVocabRecord>;
  attempts: TestAttemptRecord[];
  onBackToStudy: () => void;
  onLogout: () => void;
  onOpenSavedVocab?: () => void;
  onOpenTestHistory?: () => void;
  onUpdateUser?: (updated: UserProfile) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  user,
  lessons,
  markedMap,
  attempts,
  onBackToStudy,
  onLogout,
  onOpenSavedVocab,
  onOpenTestHistory,
  onUpdateUser,
}) => {
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(user.displayName);
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [displayNameSavedMsg, setDisplayNameSavedMsg] = useState<string | null>(null);
  const [mediaModalMode, setMediaModalMode] = useState<'avatar' | 'cover' | null>(null);

  useEffect(() => {
    setDisplayNameDraft(user.displayName);
  }, [user.displayName]);

  const handleSaveDisplayName = async () => {
    const clean = displayNameDraft.trim().replace(/\s+/g, ' ');
    if (!clean) {
      setDisplayNameError('Tên hiển thị không được để trống.');
      return;
    }
    if (clean.length > 60) {
      setDisplayNameError('Tên hiển thị tối đa 60 ký tự.');
      return;
    }
    setSavingDisplayName(true);
    setDisplayNameError(null);
    setDisplayNameSavedMsg(null);
    try {
      const res = await api.updateProfile({ displayName: clean });
      onUpdateUser?.(res.user);
      setEditingDisplayName(false);
      setDisplayNameSavedMsg('Đã cập nhật tên hiển thị.');
    } catch (err) {
      setDisplayNameError(err instanceof Error ? err.message : 'Không cập nhật được tên hiển thị.');
    } finally {
      setSavingDisplayName(false);
    }
  };

  const markedCount = Object.keys(markedMap).length;
  const customLessonCount = lessons.filter((l) => !l.isSystem).length;
  const joinedDate = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';

  const avatarPreset = getAvatarPreset(user.avatarUrl);
  const coverPreset = getCoverPreset(user.coverUrl);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pop-in">
      {/* Thanh điều hướng quay lại */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToStudy}
          className="px-3.5 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-stone-100 dark:hover:bg-slate-800 text-xs font-bold text-gray-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Quay lại Tổng quan
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
        <div
          className={`h-32 sm:h-36 relative overflow-hidden ${
            isImageMediaUrl(user.coverUrl) ? 'bg-slate-900' : coverPreset.gradientClass
          }`}
        >
          {isImageMediaUrl(user.coverUrl) ? (
            <img
              src={user.coverUrl!}
              alt="Ảnh nền hồ sơ"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 opacity-15 bg-[radial-gradient(circle_at_top_right,#fff,transparent_60%)]" />
          )}
          <button
            type="button"
            onClick={() => setMediaModalMode('cover')}
            className="absolute top-3 right-3 px-3 py-1.5 rounded-xl bg-black/45 hover:bg-black/65 text-white text-[11px] font-bold backdrop-blur-md border border-white/20 inline-flex items-center gap-1.5 transition shadow-sm"
            title="Chọn ảnh nền hồ sơ"
          >
            <Camera className="w-3.5 h-3.5" /> Đổi ảnh nền
          </button>
        </div>

        <div className="px-6 pb-6 -mt-12 flex flex-col sm:flex-row sm:items-end justify-between gap-4 relative">
          <div className="flex items-end gap-4">
            <div className="relative flex-shrink-0">
              <div className="w-24 h-24 rounded-3xl overflow-hidden bg-gradient-to-br from-slate-800 to-slate-950 dark:from-red-600 dark:to-amber-600 border-4 border-white dark:border-slate-900 shadow-lg flex items-center justify-center text-white text-2xl font-black tracking-wide">
                {isImageMediaUrl(user.avatarUrl) ? (
                  <img
                    src={user.avatarUrl!}
                    alt={user.displayName}
                    className="w-full h-full object-cover"
                  />
                ) : avatarPreset ? (
                  <div
                    className={`w-full h-full ${avatarPreset.gradientClass} flex items-center justify-center chinese-serif text-4xl font-black text-white`}
                  >
                    {avatarPreset.symbol}
                  </div>
                ) : (
                  <span>{getInitials(user.displayName)}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setMediaModalMode('avatar')}
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-slate-700 border border-stone-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:text-red-600 dark:hover:text-red-300 shadow-md flex items-center justify-center transition"
                title="Đổi ảnh đại diện"
                aria-label="Đổi ảnh đại diện"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
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
          </div>
        </div>
      </div>

      {/* Thống kê tổng quan */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={onOpenSavedVocab}
          disabled={!onOpenSavedVocab}
          className="text-left bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-700 p-5 flex items-center gap-4 transition disabled:cursor-default"
        >
          <div className="w-11 h-11 rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
            <Flag className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">
              {markedCount}
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Từ đang đánh dấu</p>
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenTestHistory}
          disabled={!onOpenTestHistory}
          className="text-left bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 hover:border-red-300 dark:hover:border-red-700 p-5 flex items-center gap-4 transition disabled:cursor-default"
        >
          <div className="w-11 h-11 rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center flex-shrink-0">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">
              {attempts.length}
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Lượt làm bài kiểm tra</p>
          </div>
        </button>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-2xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">
              {customLessonCount}
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Buổi học tự tạo</p>
          </div>
        </div>
      </div>

      {/* Thông tin tài khoản */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-6 space-y-4">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Thông tin tài khoản</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-gray-500 dark:text-slate-400">Tên hiển thị</span>
              {!editingDisplayName && (
                <button
                  type="button"
                  onClick={() => {
                    setDisplayNameDraft(user.displayName);
                    setDisplayNameError(null);
                    setDisplayNameSavedMsg(null);
                    setEditingDisplayName(true);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-[11px] font-semibold text-gray-700 dark:text-slate-200 hover:border-red-400 hover:text-red-600 dark:hover:text-red-300 transition"
                >
                  <Edit3 className="w-3 h-3" /> Sửa
                </button>
              )}
            </div>
            {editingDisplayName ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    type="text"
                    value={displayNameDraft}
                    maxLength={60}
                    autoFocus
                    disabled={savingDisplayName}
                    onChange={(e) => setDisplayNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleSaveDisplayName();
                      } else if (e.key === 'Escape') {
                        setEditingDisplayName(false);
                        setDisplayNameDraft(user.displayName);
                        setDisplayNameError(null);
                      }
                    }}
                    placeholder="Nhập tên hiển thị mới..."
                    className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-xl border border-stone-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-semibold text-gray-900 dark:text-white focus:outline-none focus:border-red-500"
                  />
                  <button
                    type="button"
                    disabled={savingDisplayName}
                    onClick={() => void handleSaveDisplayName()}
                    className="px-2.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-bold inline-flex items-center gap-1 transition"
                  >
                    {savingDisplayName ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    Lưu
                  </button>
                  <button
                    type="button"
                    disabled={savingDisplayName}
                    onClick={() => {
                      setEditingDisplayName(false);
                      setDisplayNameDraft(user.displayName);
                      setDisplayNameError(null);
                    }}
                    className="p-1.5 rounded-xl border border-stone-200 dark:border-slate-700 text-gray-500 hover:bg-stone-100 dark:hover:bg-slate-800 transition"
                    title="Huỷ"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {displayNameError && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                    {displayNameError}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <span className="font-bold text-gray-900 dark:text-white block">
                  {user.displayName}
                </span>
                {displayNameSavedMsg && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium block">
                    {displayNameSavedMsg}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
            <span className="text-gray-500 dark:text-slate-400 block mb-0.5">Email đăng nhập</span>
            <span className="font-bold text-gray-900 dark:text-white">{user.email}</span>
          </div>
          <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
            <span className="text-gray-500 dark:text-slate-400 block mb-0.5">Vai trò</span>
            <span className="font-bold text-gray-900 dark:text-white uppercase font-mono">
              {user.role}
            </span>
          </div>
          <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-slate-800/50 border border-stone-200/70 dark:border-slate-800">
            <span className="text-gray-500 dark:text-slate-400 block mb-0.5">ID tài khoản</span>
            <span className="font-mono text-[11px] text-gray-700 dark:text-slate-300 break-all">
              {user.id}
            </span>
          </div>
        </div>
      </div>

      {mediaModalMode && (
        <ProfileMediaModal
          mode={mediaModalMode}
          currentValue={mediaModalMode === 'avatar' ? user.avatarUrl : user.coverUrl}
          initials={getInitials(user.displayName)}
          onClose={() => setMediaModalMode(null)}
          onSave={async (nextValue) => {
            const payload =
              mediaModalMode === 'avatar'
                ? { avatarUrl: nextValue }
                : { coverUrl: nextValue };
            const res = await api.updateProfile(payload);
            onUpdateUser?.(res.user);
          }}
        />
      )}
    </div>
  );
};
