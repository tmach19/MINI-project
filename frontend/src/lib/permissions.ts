import type { UserProfile } from '../types';

export const PERMISSIONS = {
  MENU_SYSTEM: 'MENU_SYSTEM',
  LESSON_SYSTEM_CREATE: 'LESSON_SYSTEM_CREATE',
  LESSON_SYSTEM_EDIT: 'LESSON_SYSTEM_EDIT',
  LESSON_SYSTEM_DELETE: 'LESSON_SYSTEM_DELETE',

  MENU_LEARNING: 'MENU_LEARNING',
  LESSON_CUSTOM_CRUD: 'LESSON_CUSTOM_CRUD',
  VOCAB_BOOKMARK: 'VOCAB_BOOKMARK',
  EXAM_TAKE: 'EXAM_TAKE',
  AI_ASSISTANT_USE: 'AI_ASSISTANT_USE',

  MENU_ADMIN: 'MENU_ADMIN',
  USER_MANAGE: 'USER_MANAGE',
  ROLE_MANAGE: 'ROLE_MANAGE',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Kiểm tra quyền theo mô hình ICDS (PERMISSION_GUIDE.md):
 * - Super Admin (isSuperAdmin hoặc role === 'admin') luôn bypass tất cả kiểm tra
 * - Nếu không truyền mã quyền (undefined hoặc mảng rỗng) => cho qua
 * - Cơ chế OR: chỉ cần user có 1 trong các mã quyền truyền vào là thoả mãn
 */
export function hasPermission(
  user: UserProfile | null | undefined,
  required?: string | string[]
): boolean {
  const codes = !required ? [] : Array.isArray(required) ? required : [required];
  if (codes.length === 0) return true;
  if (!user) return false;
  if (user.isSuperAdmin || user.role === 'admin') return true;
  const userPerms = user.permissions || [];
  return codes.some((code) => userPerms.includes(code));
}

export function isSuperAdminUser(user: UserProfile | null | undefined): boolean {
  return Boolean(user && (user.isSuperAdmin || user.role === 'admin'));
}
