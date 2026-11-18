import React, { useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { ErrorBanner, ModalCloseButton, ModalShell } from './common/ModalShell';
import type { UserProfile } from '../types';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: (token: string, user: UserProfile) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onClose, onSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login({ email, password })
          : await api.register({ email, password, displayName });
      onSuccess(res.token, res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidthClass="max-w-md">
      <div className="p-6 bg-stone-50 dark:bg-slate-800/60 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            {mode === 'login' ? 'Đăng nhập tài khoản' : 'Tạo tài khoản học tập'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            Đồng bộ tiến độ SRS, điểm kiểm tra và bài học tự tạo lên tài khoản của bạn.
          </p>
        </div>
        <ModalCloseButton onClick={onClose} />
      </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {mode === 'register' && (
            <div>
              <label className="text-xs font-bold text-gray-700 dark:text-slate-300 block mb-1">
                Tên hiển thị
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ví dụ: Minh Anh"
                required
                className="w-full p-2.5 text-sm rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:border-red-500"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-slate-300 block mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ban@example.com"
              required
              className="w-full p-2.5 text-sm rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:border-red-500"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 dark:text-slate-300 block mb-1">
              Mật khẩu (tối thiểu 6 ký tự)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              className="w-full p-2.5 text-sm rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:border-red-500"
            />
          </div>

          <ErrorBanner message={error} />

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-bold flex items-center justify-center gap-2 transition"
          >
            {mode === 'login' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {loading ? 'Đang xử lý...' : mode === 'login' ? 'Đăng nhập' : 'Đăng ký ngay'}
          </button>

          <div className="text-center text-xs text-gray-500 dark:text-slate-400 pt-1">
            {mode === 'login' ? (
              <>
                Chưa có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className="text-red-600 dark:text-red-400 font-bold hover:underline"
                >
                  Đăng ký miễn phí
                </button>
              </>
            ) : (
              <>
                Đã có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className="text-red-600 dark:text-red-400 font-bold hover:underline"
                >
                  Đăng nhập
                </button>
              </>
            )}
          </div>
        </form>
    </ModalShell>
  );
};
