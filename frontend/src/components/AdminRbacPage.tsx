import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { hasPermission, PERMISSIONS } from '../lib/permissions';
import type {
  AdminUserRbacRow,
  PermissionCatalogItem,
  RoleWithPermissions,
  UserProfile,
} from '../types';
import { LoadingCard } from './common/LoadingState';
import { ErrorBanner } from './common/ModalShell';

interface AdminRbacPageProps {
  currentUser: UserProfile;
  onBackToStudy: () => void;
  onRefreshCurrentUser: () => Promise<void>;
}

interface PermissionGroup {
  parent: PermissionCatalogItem;
  children: PermissionCatalogItem[];
}

function buildPermissionGroups(catalog: PermissionCatalogItem[]): PermissionGroup[] {
  const parents = catalog.filter((p) => !p.parentCode);
  return parents.map((parent) => ({
    parent,
    children: catalog.filter((p) => p.parentCode === parent.code),
  }));
}

export const AdminRbacPage: React.FC<AdminRbacPageProps> = ({
  currentUser,
  onBackToStudy,
  onRefreshCurrentUser,
}) => {
  const canManageUsers = hasPermission(currentUser, PERMISSIONS.USER_MANAGE);
  const canManageRoles = hasPermission(currentUser, PERMISSIONS.ROLE_MANAGE);

  const [tab, setTab] = useState<'users' | 'roles'>(canManageUsers ? 'users' : 'roles');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [users, setUsers] = useState<AdminUserRbacRow[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Draft cho quyền riêng của user đang chọn (effective set)
  const [draftUserEffective, setDraftUserEffective] = useState<Set<string>>(new Set());
  const [savingUserPerms, setSavingUserPerms] = useState(false);
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(null);

  // Draft cho quyền mặc định của role 'user'
  const [draftUserRolePerms, setDraftUserRolePerms] = useState<Set<string>>(new Set());
  const [savingRolePerms, setSavingRolePerms] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [catRes, usersRes] = await Promise.all([
        api.getRbacCatalog(),
        canManageUsers || canManageRoles ? api.listAdminUsers('') : Promise.resolve({ users: [] }),
      ]);
      setCatalog(catRes.permissions);
      setRoles(catRes.roles);
      setUsers(usersRes.users);

      const userRole = catRes.roles.find((r) => r.code === 'user');
      setDraftUserRolePerms(new Set(userRole?.permissionIds || []));

      setSelectedUserId((prev) => {
        if (prev && usersRes.users.some((u) => u.id === prev)) return prev;
        return usersRes.users[0]?.id || null;
      });
    } catch (err) {
      setError((err as Error).message || 'Không tải được dữ liệu phân quyền.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const groups = useMemo(() => buildPermissionGroups(catalog), [catalog]);

  const filteredUsers = useMemo(() => {
    const q = searchKeyword.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q)
    );
  }, [users, searchKeyword]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  useEffect(() => {
    if (!selectedUser) {
      setDraftUserEffective(new Set());
      return;
    }
    setDraftUserEffective(new Set(selectedUser.effectivePermissions));
  }, [selectedUser]);

  const handleRoleChange = async (targetUser: AdminUserRbacRow, nextRole: 'admin' | 'user') => {
    if (targetUser.role === nextRole) return;
    setError(null);
    setNotice(null);
    setUpdatingRoleUserId(targetUser.id);
    try {
      const res = await api.updateAdminUserRole(targetUser.id, nextRole);
      setUsers((prev) => prev.map((u) => (u.id === targetUser.id ? res.user : u)));
      setNotice(
        `Đã chuyển vai trò của ${targetUser.displayName} thành ${
          nextRole === 'admin' ? 'Quản trị viên' : 'Học viên'
        }.`
      );
      if (targetUser.id === currentUser.id) {
        await onRefreshCurrentUser();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingRoleUserId(null);
    }
  };

  const handleRefresh = () => {
    setSearchKeyword('');
    void loadData();
  };

  const toggleDraftUserPerm = (code: string) => {
    setDraftUserEffective((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const computeUserOverrides = (target: AdminUserRbacRow, effective: Set<string>) => {
    const roleSet = new Set(target.rolePermissions);
    const addedPermissions = Array.from(effective).filter((code) => !roleSet.has(code));
    const excludedPermissions = target.rolePermissions.filter((code) => !effective.has(code));
    return { addedPermissions, excludedPermissions };
  };

  const handleSaveUserOverrides = async () => {
    if (!selectedUser || selectedUser.role === 'admin') return;
    setError(null);
    setNotice(null);
    setSavingUserPerms(true);
    try {
      const payload = computeUserOverrides(selectedUser, draftUserEffective);
      const res = await api.saveAdminUserPermissions(selectedUser.id, payload);
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? res.user : u)));
      setNotice(`Đã lưu phân quyền riêng cho ${selectedUser.displayName}.`);
      if (selectedUser.id === currentUser.id) {
        await onRefreshCurrentUser();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingUserPerms(false);
    }
  };

  const handleResetUserToRoleDefault = () => {
    if (!selectedUser) return;
    setDraftUserEffective(new Set(selectedUser.rolePermissions));
  };

  const toggleDraftRolePerm = (code: string) => {
    setDraftUserRolePerms((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSaveUserRoleDefaults = async () => {
    setError(null);
    setNotice(null);
    setSavingRolePerms(true);
    try {
      await api.updateRolePermissions('user', Array.from(draftUserRolePerms));
      await loadData();
      await onRefreshCurrentUser();
      setNotice('Đã cập nhật bộ quyền mặc định cho vai trò Học viên.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingRolePerms(false);
    }
  };

  const draftOverridesPreview = useMemo(() => {
    if (!selectedUser || selectedUser.role === 'admin') {
      return { addedPermissions: [], excludedPermissions: [] };
    }
    return computeUserOverrides(selectedUser, draftUserEffective);
  }, [selectedUser, draftUserEffective]);

  const userOverridesChanged = useMemo(() => {
    if (!selectedUser || selectedUser.role === 'admin') return false;
    const prevSet = new Set(selectedUser.effectivePermissions);
    if (prevSet.size !== draftUserEffective.size) return true;
    for (const c of draftUserEffective) {
      if (!prevSet.has(c)) return true;
    }
    return false;
  }, [selectedUser, draftUserEffective]);

  if (loading) {
    return (
      <LoadingCard
        message="Đang tải hệ thống phân quyền..."
        subMessage="Đồng bộ danh mục chức năng, vai trò và quyền chi tiết"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600 to-amber-600 text-white flex items-center justify-center shadow-md flex-shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-black text-gray-900 dark:text-white">
                Quản trị &amp; Phân quyền
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                RBAC (Admin / User)
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              Gán vai trò, cấu hình quyền mặc định và tinh chỉnh cấp thêm / hạn chế quyền riêng theo từng tài khoản.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={handleRefresh}
            className="px-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 disabled:opacity-50 transition"
            title="Xóa từ khóa tìm kiếm và tải lại dữ liệu"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới
          </button>
          <button
            type="button"
            onClick={onBackToStudy}
            className="px-3.5 py-2 rounded-xl bg-stone-900 dark:bg-slate-800 hover:bg-stone-800 dark:hover:bg-slate-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Quay lại học tập
          </button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {notice && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-stone-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-stone-200 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-800/40 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('users')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition ${
              tab === 'users'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-gray-600 dark:text-slate-300 hover:bg-stone-200/70 dark:hover:bg-slate-700'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Tài khoản &amp; Phân quyền riêng ({users.length})
          </button>
          {canManageRoles && (
            <button
              type="button"
              onClick={() => setTab('roles')}
              className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition ${
                tab === 'roles'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-slate-300 hover:bg-stone-200/70 dark:hover:bg-slate-700'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" /> Quyền mặc định theo Vai trò ({roles.length})
            </button>
          )}
        </div>

        {tab === 'users' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-stone-200 dark:divide-slate-800">
            {/* Master List */}
            <div className="lg:col-span-5 p-5 space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder="Tìm theo tên hiển thị hoặc email..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-800 text-xs text-gray-900 dark:text-white"
                />
              </div>

              {filteredUsers.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500 dark:text-slate-400 border border-dashed border-stone-200 dark:border-slate-800 rounded-2xl">
                  Không tìm thấy tài khoản nào khớp từ khoá.
                </div>
              ) : (
                <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
                  {filteredUsers.map((u) => {
                    const isSelected = u.id === selectedUserId;
                    const isSelf = u.id === currentUser.id;
                    return (
                      <div
                        key={u.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedUserId(u.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedUserId(u.id);
                          }
                        }}
                        className={`p-3.5 rounded-2xl border transition cursor-pointer ${
                          isSelected
                            ? 'bg-red-50/70 dark:bg-red-950/30 border-red-300 dark:border-red-800 shadow-sm'
                            : 'bg-white dark:bg-slate-900 border-stone-200 dark:border-slate-800 hover:bg-stone-50 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-gray-900 dark:text-white truncate">
                                {u.displayName}
                              </span>
                              {isSelf && (
                                <span className="px-1.5 py-0.5 rounded bg-stone-200 dark:bg-slate-700 text-[10px] font-bold text-gray-700 dark:text-slate-200">
                                  Bạn
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate mt-0.5">
                              {u.email}
                            </p>
                          </div>

                          <div
                            className="flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <select
                              value={u.role}
                              disabled={!canManageUsers || isSelf || updatingRoleUserId === u.id}
                              onChange={(e) =>
                                void handleRoleChange(u, e.target.value as 'admin' | 'user')
                              }
                              title={
                                isSelf
                                  ? 'Không thể tự hạ vai trò của chính mình'
                                  : 'Đổi vai trò tài khoản'
                              }
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                                u.role === 'admin'
                                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                                  : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                              } disabled:opacity-60`}
                            >
                              <option value="user">Học viên</option>
                              <option value="admin">Quản trị viên</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap mt-2.5 text-[10px] font-semibold">
                          <span className="px-2 py-0.5 rounded-md bg-stone-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300">
                            {u.effectivePermissions.length} quyền hiệu lực
                          </span>
                          {u.addedPermissions.length > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                              +{u.addedPermissions.length} cấp thêm
                            </span>
                          )}
                          {u.excludedPermissions.length > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                              -{u.excludedPermissions.length} hạn chế
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Detail Permission Matrix */}
            <div className="lg:col-span-7 p-5 space-y-4">
              {!selectedUser ? (
                <div className="p-10 text-center text-xs text-gray-500 dark:text-slate-400">
                  Chọn một tài khoản bên trái để xem và tinh chỉnh quyền.
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-200 dark:border-slate-800">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Shield className="w-4 h-4 text-red-500" />
                        Quyền chi tiết: {selectedUser.displayName}
                      </h2>
                      <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                        Công thức hiệu lực = (Quyền vai trò ∪ Cấp thêm) − Hạn chế riêng
                      </p>
                    </div>

                    {selectedUser.role !== 'admin' && canManageRoles && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleResetUserToRoleDefault}
                          disabled={
                            savingUserPerms ||
                            (draftOverridesPreview.addedPermissions.length === 0 &&
                              draftOverridesPreview.excludedPermissions.length === 0)
                          }
                          className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-slate-700 text-[11px] font-semibold text-gray-700 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Về mặc định
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveUserOverrides()}
                          disabled={savingUserPerms || !userOverridesChanged}
                          className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold disabled:opacity-40 inline-flex items-center gap-1.5 shadow-sm"
                        >
                          <Save className="w-3.5 h-3.5" />
                          {savingUserPerms ? 'Đang lưu...' : 'Lưu phân quyền'}
                        </button>
                      </div>
                    )}
                  </div>

                  {selectedUser.role === 'admin' ? (
                    <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
                      <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Super Admin Bypass đang bật</p>
                        <p className="text-[11px] mt-0.5 opacity-90">
                          Tài khoản vai trò <strong>Quản trị viên</strong> mặc định sở hữu toàn bộ {catalog.length} mã quyền hệ thống và bỏ qua kiểm tra ngoại lệ. Nếu muốn giới hạn quyền, hãy chuyển vai trò sang <strong>Học viên</strong> rồi tinh chỉnh từng quyền bên dưới.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-4">
                    {groups.map(({ parent, children }) => {
                      const items = [parent, ...children];
                      return (
                        <div
                          key={parent.id}
                          className="rounded-2xl border border-stone-200 dark:border-slate-800 overflow-hidden"
                        >
                          <div className="px-4 py-2.5 bg-stone-50 dark:bg-slate-800/60 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-gray-900 dark:text-white">
                              {parent.name}
                            </span>
                            <span className="text-[10px] font-mono text-gray-500 dark:text-slate-400">
                              {parent.code}
                            </span>
                          </div>
                          <div className="divide-y divide-stone-100 dark:divide-slate-800/80">
                            {items.map((perm) => {
                              const checked =
                                selectedUser.role === 'admin' || draftUserEffective.has(perm.code);
                              const fromRole = selectedUser.rolePermissions.includes(perm.code);
                              const isAdded =
                                selectedUser.role !== 'admin' && !fromRole && checked;
                              const isExcluded =
                                selectedUser.role !== 'admin' && fromRole && !checked;

                              return (
                                <label
                                  key={perm.id}
                                  className={`px-4 py-2.5 flex items-center justify-between gap-3 text-xs ${
                                    selectedUser.role === 'admin' || !canManageRoles
                                      ? 'opacity-80 cursor-default'
                                      : 'cursor-pointer hover:bg-stone-50 dark:hover:bg-slate-800/40'
                                  }`}
                                >
                                  <div className="flex items-start gap-2.5 min-w-0">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={selectedUser.role === 'admin' || !canManageRoles}
                                      onChange={() => toggleDraftUserPerm(perm.code)}
                                      className="mt-0.5 rounded border-stone-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
                                    />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold text-gray-900 dark:text-slate-100">
                                          {perm.name}
                                        </span>
                                        <code className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-slate-800 text-[10px] text-gray-600 dark:text-slate-300">
                                          {perm.code}
                                        </code>
                                      </div>
                                      {perm.description && (
                                        <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                                          {perm.description}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex-shrink-0">
                                    {selectedUser.role === 'admin' ? (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                                        Super Admin
                                      </span>
                                    ) : isAdded ? (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                                        Cấp thêm
                                      </span>
                                    ) : isExcluded ? (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 inline-flex items-center gap-1">
                                        <ShieldAlert className="w-3 h-3" /> Hạn chế
                                      </span>
                                    ) : fromRole ? (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                                        Kế thừa
                                      </span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400">
                                        Chưa cấp
                                      </span>
                                    )}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          /* Tab 2: Cấu hình quyền mặc định theo Vai trò */
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="p-4 rounded-2xl border border-stone-200 dark:border-slate-800 bg-stone-50/60 dark:bg-slate-800/40 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {role.name} ({role.code})
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 text-gray-700 dark:text-slate-200">
                      {role.code === 'admin'
                        ? `${catalog.length}/${catalog.length} quyền`
                        : `${draftUserRolePerms.size}/${catalog.length} quyền`}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{role.description}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                  Cấu hình bộ quyền mặc định cho vai trò Học viên (`user`)
                </h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Mọi tài khoản Học viên sẽ tự động kế thừa các quyền bên dưới (trừ trường hợp bị tinh chỉnh riêng ở tab Tài khoản).
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveUserRoleDefaults()}
                disabled={savingRolePerms}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {savingRolePerms ? 'Đang lưu...' : 'Lưu cấu hình vai trò'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.map(({ parent, children }) => {
                const items = [parent, ...children];
                return (
                  <div
                    key={parent.id}
                    className="rounded-2xl border border-stone-200 dark:border-slate-800 overflow-hidden"
                  >
                    <div className="px-4 py-2.5 bg-stone-50 dark:bg-slate-800/60 border-b border-stone-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">
                        {parent.name}
                      </span>
                      <span className="text-[10px] font-mono text-gray-500 dark:text-slate-400">
                        {parent.code}
                      </span>
                    </div>
                    <div className="divide-y divide-stone-100 dark:divide-slate-800">
                      {items.map((perm) => (
                        <label
                          key={perm.id}
                          className="px-4 py-2.5 flex items-start gap-2.5 text-xs cursor-pointer hover:bg-stone-50 dark:hover:bg-slate-800/40"
                        >
                          <input
                            type="checkbox"
                            checked={draftUserRolePerms.has(perm.code)}
                            onChange={() => toggleDraftRolePerm(perm.code)}
                            className="mt-0.5 rounded border-stone-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
                          />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900 dark:text-slate-100">
                                {perm.name}
                              </span>
                              <code className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-slate-800 text-[10px] text-gray-600 dark:text-slate-300">
                                {perm.code}
                              </code>
                            </div>
                            {perm.description && (
                              <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                                {perm.description}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
