import {
  DEFAULT_ROLE_PERMISSION_MAP,
  type PermissionCatalogItem,
} from '../config/rbacCatalog.js';
import { memoryStore } from '../db/fallbackStore.js';
import { getAuthDbMode, getPool } from '../db/pool.js';
import type { AdminUserRbacRow, RoleWithPermissions } from '../types/domain.js';

let warnedMissingRbacSchema = false;

function isMissingRbacSchemaError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42P01' || code === '42883';
}

export async function getEffectivePermissions(
  userId: string,
  role: 'user' | 'admin'
): Promise<string[]> {
  if (getAuthDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    return memoryStore.resolveUserPermissions(userId, role);
  }

  const pool = getPool()!;
  try {
    const res = await pool.query<{ code: string }>(
      'SELECT code FROM fn_get_user_permissions($1::uuid)',
      [userId]
    );
    return res.rows.map((r) => r.code);
  } catch (err) {
    if (isMissingRbacSchemaError(err)) {
      if (!warnedMissingRbacSchema) {
        warnedMissingRbacSchema = true;
        console.warn(
          '[RBAC] Chưa tìm thấy bảng/function RBAC trên PostgreSQL — đang dùng fallback quyền mặc định theo role. Hãy chạy Liquibase migration.'
        );
      }
      return [...DEFAULT_ROLE_PERMISSION_MAP[role]];
    }
    throw err;
  }
}

export async function listPermissionsCatalog(): Promise<PermissionCatalogItem[]> {
  if (getAuthDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    return memoryStore.permissionsCatalog.filter((p) => p.activeFlg);
  }

  const pool = getPool()!;
  const res = await pool.query<{
    id: string;
    code: string;
    name: string;
    type: 'MENU' | 'ACTION';
    parent_code: string | null;
    description: string | null;
    sort_order: number;
    active_flg: boolean;
  }>(
    `SELECT id, code, name, type, parent_code, description, sort_order, active_flg
     FROM permissions
     WHERE active_flg = TRUE
     ORDER BY sort_order ASC, code ASC`
  );

  return res.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    parentCode: r.parent_code,
    description: r.description || '',
    sortOrder: r.sort_order,
    activeFlg: r.active_flg,
  }));
}

export async function listRolesWithPermissions(): Promise<RoleWithPermissions[]> {
  if (getAuthDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    return memoryStore.roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      activeFlg: r.activeFlg,
      permissionIds: Array.from(memoryStore.rolePermissions.get(r.id) || []),
    }));
  }

  const pool = getPool()!;
  const [rolesRes, rpRes] = await Promise.all([
    pool.query<{
      id: 'admin' | 'user';
      code: 'admin' | 'user';
      name: string;
      description: string | null;
      is_system: boolean;
      active_flg: boolean;
    }>(
      `SELECT id, code, name, description, is_system, active_flg
       FROM roles
       WHERE active_flg = TRUE
       ORDER BY CASE WHEN code = 'admin' THEN 0 ELSE 1 END, code ASC`
    ),
    pool.query<{ role_id: string; permission_id: string }>(
      `SELECT rp.role_id, rp.permission_id
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id AND p.active_flg = TRUE
       WHERE rp.is_deleted = 0`
    ),
  ]);

  const byRole = new Map<string, string[]>();
  for (const row of rpRes.rows) {
    const arr = byRole.get(row.role_id) || [];
    arr.push(row.permission_id);
    byRole.set(row.role_id, arr);
  }

  return rolesRes.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description || '',
    isSystem: r.is_system,
    activeFlg: r.active_flg,
    permissionIds: byRole.get(r.id) || [],
  }));
}

export async function updateRolePermissions(
  roleId: 'admin' | 'user',
  permissionIds: string[]
): Promise<RoleWithPermissions> {
  if (roleId === 'admin') {
    throw new Error('Vai trò Quản trị viên (Super Admin) luôn có toàn quyền hệ thống, không thể thu hồi.');
  }

  const catalog = await listPermissionsCatalog();
  const validSet = new Set(catalog.map((p) => p.id));
  const cleanIds = Array.from(new Set(permissionIds.filter((id) => validSet.has(id))));

  if (getAuthDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    memoryStore.rolePermissions.set(roleId, new Set(cleanIds));
    const role = memoryStore.roles.find((r) => r.id === roleId)!;
    return { ...role, permissionIds: cleanIds };
  }

  const pool = getPool()!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE role_permissions SET is_deleted = 1, deleted_at = NOW() WHERE role_id = $1 AND is_deleted = 0',
      [roleId]
    );
    for (const permId of cleanIds) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id, is_deleted, deleted_at)
         VALUES ($1, $2, 0, NULL)
         ON CONFLICT (role_id, permission_id) DO UPDATE SET is_deleted = 0, deleted_at = NULL`,
        [roleId, permId]
      );
    }
    await client.query('UPDATE roles SET updated_at = NOW() WHERE id = $1', [roleId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const roles = await listRolesWithPermissions();
  return roles.find((r) => r.id === roleId)!;
}

export async function listUsersWithRbac(keyword = ''): Promise<AdminUserRbacRow[]> {
  const q = keyword.trim().toLowerCase();

  if (getAuthDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const userRolePerms = Array.from(memoryStore.rolePermissions.get('user') || []);
    const adminRolePerms = memoryStore.permissionsCatalog.map((p) => p.code);

    return memoryStore.users
      .filter((u) => !q || u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((u) => {
        const overrides = memoryStore.userOverrides.get(u.id);
        const added: string[] = [];
        const excluded: string[] = [];
        if (overrides) {
          for (const [permId, isExcl] of overrides.entries()) {
            if (isExcl) excluded.push(permId);
            else added.push(permId);
          }
        }
        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          role: u.role,
          isSuperAdmin: u.role === 'admin',
          createdAt: u.createdAt,
          rolePermissions: u.role === 'admin' ? adminRolePerms : userRolePerms,
          addedPermissions: added,
          excludedPermissions: excluded,
          effectivePermissions: memoryStore.resolveUserPermissions(u.id, u.role),
        };
      });
  }

  const pool = getPool()!;
  const [usersRes, rpRes, upRes, catalog] = await Promise.all([
    pool.query<{
      id: string;
      email: string;
      display_name: string;
      role: 'user' | 'admin';
      created_at: Date;
    }>(
      `SELECT id, email, display_name, role, created_at
       FROM users
       WHERE is_deleted = 0
         AND ($1 = '' OR LOWER(email) LIKE '%' || $1 || '%' OR LOWER(display_name) LIKE '%' || $1 || '%')
       ORDER BY created_at ASC`,
      [q]
    ),
    pool.query<{ role_id: string; permission_id: string }>(
      `SELECT rp.role_id, rp.permission_id
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id AND p.active_flg = TRUE
       WHERE rp.is_deleted = 0`
    ),
    pool.query<{ user_id: string; permission_id: string; is_excluded: boolean }>(
      `SELECT up.user_id, up.permission_id, up.is_excluded
       FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id AND p.active_flg = TRUE
       WHERE up.is_deleted = 0`
    ),
    listPermissionsCatalog(),
  ]);

  const rolePermMap = new Map<string, string[]>();
  for (const row of rpRes.rows) {
    const arr = rolePermMap.get(row.role_id) || [];
    arr.push(row.permission_id);
    rolePermMap.set(row.role_id, arr);
  }

  const userAddedMap = new Map<string, string[]>();
  const userExcludedMap = new Map<string, string[]>();
  for (const row of upRes.rows) {
    const targetMap = row.is_excluded ? userExcludedMap : userAddedMap;
    const arr = targetMap.get(row.user_id) || [];
    arr.push(row.permission_id);
    targetMap.set(row.user_id, arr);
  }

  const allActivePerms = catalog.map((p) => p.code);

  return usersRes.rows.map((u) => {
    const rolePerms = u.role === 'admin' ? allActivePerms : rolePermMap.get(u.role) || [];
    const added = u.role === 'admin' ? [] : userAddedMap.get(u.id) || [];
    const excluded = u.role === 'admin' ? [] : userExcludedMap.get(u.id) || [];
    const excludedSet = new Set(excluded);
    const effective =
      u.role === 'admin'
        ? allActivePerms
        : Array.from(new Set([...rolePerms, ...added])).filter((code) => !excludedSet.has(code));

    return {
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      isSuperAdmin: u.role === 'admin',
      createdAt: u.created_at.toISOString(),
      rolePermissions: rolePerms,
      addedPermissions: added,
      excludedPermissions: excluded,
      effectivePermissions: effective,
    };
  });
}

export async function updateUserRole(
  targetUserId: string,
  nextRole: 'admin' | 'user',
  actorUserId: string
): Promise<AdminUserRbacRow | null> {
  if (targetUserId === actorUserId && nextRole !== 'admin') {
    throw new Error('Không thể tự hạ vai trò Quản trị viên của chính bạn.');
  }

  if (getAuthDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const user = memoryStore.users.find((u) => u.id === targetUserId);
    if (!user) return null;
    user.role = nextRole;
    const rows = await listUsersWithRbac('');
    return rows.find((r) => r.id === targetUserId) || null;
  }

  const pool = getPool()!;
  const res = await pool.query(
    'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2::uuid AND is_deleted = 0 RETURNING id',
    [nextRole, targetUserId]
  );
  if (res.rowCount === 0) return null;

  const rows = await listUsersWithRbac('');
  return rows.find((r) => r.id === targetUserId) || null;
}

export async function saveUserPermissionOverrides(
  targetUserId: string,
  addedPermissionIds: string[],
  excludedPermissionIds: string[],
  actorUserId: string
): Promise<AdminUserRbacRow | null> {
  const catalog = await listPermissionsCatalog();
  const validSet = new Set(catalog.map((p) => p.id));

  const cleanExcluded = new Set(excludedPermissionIds.filter((id) => validSet.has(id)));
  const cleanAdded = Array.from(
    new Set(addedPermissionIds.filter((id) => validSet.has(id) && !cleanExcluded.has(id)))
  );
  const finalExcluded = Array.from(cleanExcluded);

  if (getAuthDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const target = memoryStore.users.find((u) => u.id === targetUserId);
    if (!target) return null;
    if (target.role === 'admin') {
      throw new Error('Tài khoản Quản trị viên (Super Admin) mặc định có toàn quyền, không áp dụng ngoại lệ.');
    }
    const nextMap = new Map<string, boolean>();
    for (const id of cleanAdded) nextMap.set(id, false);
    for (const id of finalExcluded) nextMap.set(id, true);
    memoryStore.userOverrides.set(targetUserId, nextMap);

    const rows = await listUsersWithRbac('');
    return rows.find((r) => r.id === targetUserId) || null;
  }

  const pool = getPool()!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query<{ role: 'admin' | 'user' }>(
      'SELECT role FROM users WHERE id = $1::uuid AND is_deleted = 0',
      [targetUserId]
    );
    const target = userRes.rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return null;
    }
    if (target.role === 'admin') {
      throw new Error('Tài khoản Quản trị viên (Super Admin) mặc định có toàn quyền, không áp dụng ngoại lệ.');
    }

    await client.query(
      'UPDATE user_permissions SET is_deleted = 1, deleted_at = NOW() WHERE user_id = $1::uuid AND is_deleted = 0',
      [targetUserId]
    );

    for (const permId of cleanAdded) {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission_id, is_excluded, updated_by, updated_at, is_deleted, deleted_at)
         VALUES ($1::uuid, $2, FALSE, $3::uuid, NOW(), 0, NULL)
         ON CONFLICT (user_id, permission_id) DO UPDATE SET
           is_excluded = FALSE,
           is_deleted = 0,
           deleted_at = NULL,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [targetUserId, permId, actorUserId]
      );
    }

    for (const permId of finalExcluded) {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission_id, is_excluded, updated_by, updated_at, is_deleted, deleted_at)
         VALUES ($1::uuid, $2, TRUE, $3::uuid, NOW(), 0, NULL)
         ON CONFLICT (user_id, permission_id) DO UPDATE SET
           is_excluded = TRUE,
           is_deleted = 0,
           deleted_at = NULL,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [targetUserId, permId, actorUserId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const rows = await listUsersWithRbac('');
  return rows.find((r) => r.id === targetUserId) || null;
}
