export interface PermissionCatalogItem {
  id: string;
  code: string;
  name: string;
  type: 'MENU' | 'ACTION';
  parentCode: string | null;
  description: string;
  sortOrder: number;
  activeFlg: boolean;
}

export interface RoleCatalogItem {
  id: 'admin' | 'user';
  code: 'admin' | 'user';
  name: string;
  description: string;
  isSystem: boolean;
  activeFlg: boolean;
}

export const PERMISSION_CODES = {
  MENU_SYSTEM: 'MENU_SYSTEM',
  LESSON_SYSTEM_CREATE: 'LESSON_SYSTEM_CREATE',
  LESSON_SYSTEM_EDIT: 'LESSON_SYSTEM_EDIT',
  LESSON_SYSTEM_DELETE: 'LESSON_SYSTEM_DELETE',

  MENU_LEARNING: 'MENU_LEARNING',
  LESSON_CUSTOM_CRUD: 'LESSON_CUSTOM_CRUD',
  VOCAB_BOOKMARK: 'VOCAB_BOOKMARK',
  EXAM_TAKE: 'EXAM_TAKE',

  MENU_ADMIN: 'MENU_ADMIN',
  USER_MANAGE: 'USER_MANAGE',
  ROLE_MANAGE: 'ROLE_MANAGE',
} as const;

export const DEFAULT_ROLES: RoleCatalogItem[] = [
  {
    id: 'admin',
    code: 'admin',
    name: 'Quản trị viên',
    description: 'Toàn quyền quản trị hệ thống, bài học HSK và phân quyền tài khoản (Super Admin)',
    isSystem: true,
    activeFlg: true,
  },
  {
    id: 'user',
    code: 'user',
    name: 'Học viên',
    description: 'Học tập, làm bài kiểm tra, đánh dấu từ vựng và quản lý buổi học tự tạo',
    isSystem: true,
    activeFlg: true,
  },
];

export const DEFAULT_PERMISSIONS: PermissionCatalogItem[] = [
  {
    id: 'MENU_SYSTEM',
    code: 'MENU_SYSTEM',
    name: 'Quản lý bài học hệ thống',
    type: 'MENU',
    parentCode: null,
    description: 'Nhóm quyền thao tác với các bài học HSK chuẩn hệ thống',
    sortOrder: 10,
    activeFlg: true,
  },
  {
    id: 'LESSON_SYSTEM_CREATE',
    code: 'LESSON_SYSTEM_CREATE',
    name: 'Tạo bài học hệ thống',
    type: 'ACTION',
    parentCode: 'MENU_SYSTEM',
    description: 'Cho phép tạo mới bài học hệ thống (is_system = true)',
    sortOrder: 11,
    activeFlg: true,
  },
  {
    id: 'LESSON_SYSTEM_EDIT',
    code: 'LESSON_SYSTEM_EDIT',
    name: 'Sửa bài học hệ thống',
    type: 'ACTION',
    parentCode: 'MENU_SYSTEM',
    description: 'Cho phép chỉnh sửa nội dung bài học hệ thống',
    sortOrder: 12,
    activeFlg: true,
  },
  {
    id: 'LESSON_SYSTEM_DELETE',
    code: 'LESSON_SYSTEM_DELETE',
    name: 'Xoá bài học hệ thống',
    type: 'ACTION',
    parentCode: 'MENU_SYSTEM',
    description: 'Cho phép xoá bài học hệ thống',
    sortOrder: 13,
    activeFlg: true,
  },
  {
    id: 'MENU_LEARNING',
    code: 'MENU_LEARNING',
    name: 'Học tập & Bài cá nhân',
    type: 'MENU',
    parentCode: null,
    description: 'Nhóm quyền học tập cơ bản của học viên',
    sortOrder: 20,
    activeFlg: true,
  },
  {
    id: 'LESSON_CUSTOM_CRUD',
    code: 'LESSON_CUSTOM_CRUD',
    name: 'Quản lý buổi học tự tạo',
    type: 'ACTION',
    parentCode: 'MENU_LEARNING',
    description: 'Tạo, sửa và xoá buổi học cá nhân do chính mình sở hữu',
    sortOrder: 21,
    activeFlg: true,
  },
  {
    id: 'VOCAB_BOOKMARK',
    code: 'VOCAB_BOOKMARK',
    name: 'Đánh dấu từ vựng',
    type: 'ACTION',
    parentCode: 'MENU_LEARNING',
    description: 'Lưu và đồng bộ từ vựng cần ôn tập vào hồ sơ cá nhân',
    sortOrder: 22,
    activeFlg: true,
  },
  {
    id: 'EXAM_TAKE',
    code: 'EXAM_TAKE',
    name: 'Làm bài kiểm tra & lưu điểm',
    type: 'ACTION',
    parentCode: 'MENU_LEARNING',
    description: 'Nộp bài kiểm tra và lưu lịch sử điểm số',
    sortOrder: 23,
    activeFlg: true,
  },
  {
    id: 'MENU_ADMIN',
    code: 'MENU_ADMIN',
    name: 'Quản trị hệ thống',
    type: 'MENU',
    parentCode: null,
    description: 'Truy cập màn hình Quản trị & Phân quyền',
    sortOrder: 30,
    activeFlg: true,
  },
  {
    id: 'USER_MANAGE',
    code: 'USER_MANAGE',
    name: 'Quản lý người dùng',
    type: 'ACTION',
    parentCode: 'MENU_ADMIN',
    description: 'Xem danh sách tài khoản và thay đổi vai trò user/admin',
    sortOrder: 31,
    activeFlg: true,
  },
  {
    id: 'ROLE_MANAGE',
    code: 'ROLE_MANAGE',
    name: 'Quản lý phân quyền',
    type: 'ACTION',
    parentCode: 'MENU_ADMIN',
    description: 'Cấu hình quyền cho vai trò và tinh chỉnh cấp thêm / hạn chế từng user',
    sortOrder: 32,
    activeFlg: true,
  },
];

export const DEFAULT_ROLE_PERMISSION_MAP: Record<'admin' | 'user', string[]> = {
  admin: DEFAULT_PERMISSIONS.map((p) => p.code),
  user: ['MENU_LEARNING', 'LESSON_CUSTOM_CRUD', 'VOCAB_BOOKMARK', 'EXAM_TAKE'],
};
