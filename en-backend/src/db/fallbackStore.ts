import fs from 'node:fs';
import { env } from '../config/env.js';
import {
  DEFAULT_PERMISSIONS,
  DEFAULT_ROLES,
  DEFAULT_ROLE_PERMISSION_MAP,
  type PermissionCatalogItem,
  type RoleCatalogItem,
} from '../config/rbacCatalog.js';
import type {
  GameGradingCacheRecord,
  GameMode,
  LanguageCode,
  LessonDetail,
  MarkedVocabRecord,
  TestAttemptRecord,
  TranslationCacheRecord,
  UserProfile,
} from '../types/domain.js';

export interface MemoryUser extends Omit<UserProfile, 'isSuperAdmin' | 'permissions'> {
  passwordHash: string;
}

export interface MemoryGameScore {
  id: string;
  userId: string;
  lessonId: string;
  languageCode: LanguageCode;
  gameMode: GameMode;
  score: number;
  maxScore: number | null;
  durationSeconds: number;
  playedAt: string;
  isDeleted: 0 | 1;
  deletedAt: string | null;
}

class FallbackMemoryStore {
  private initialized = false;
  lessons: LessonDetail[] = [];
  users: MemoryUser[] = [];
  roles: RoleCatalogItem[] = DEFAULT_ROLES.map((r) => ({ ...r }));
  permissionsCatalog: PermissionCatalogItem[] = DEFAULT_PERMISSIONS.map((p) => ({ ...p }));
  rolePermissions = new Map<'admin' | 'user', Set<string>>([
    ['admin', new Set(DEFAULT_ROLE_PERMISSION_MAP.admin)],
    ['user', new Set(DEFAULT_ROLE_PERMISSION_MAP.user)],
  ]);
  // userId -> Map<permissionId, isExcluded>
  userOverrides = new Map<string, Map<string, boolean>>();
  translationCache = new Map<string, TranslationCacheRecord>();
  gameGradingCache = new Map<string, GameGradingCacheRecord>();
  // userId -> Map<vocabId, MarkedVocabRecord>
  markedByUser = new Map<string, Map<string, MarkedVocabRecord>>();
  attemptsByUser = new Map<string, TestAttemptRecord[]>();
  gameScores: MemoryGameScore[] = [];

  resolveUserPermissions(userId: string, role: 'admin' | 'user'): string[] {
    if (role === 'admin') {
      return this.permissionsCatalog.filter((p) => p.activeFlg).map((p) => p.code);
    }
    const base = new Set(this.rolePermissions.get(role) || []);
    const overrides = this.userOverrides.get(userId);
    if (overrides) {
      for (const [permId, isExcluded] of overrides.entries()) {
        if (isExcluded) base.delete(permId);
        else base.add(permId);
      }
    }
    const orderMap = new Map(this.permissionsCatalog.map((p) => [p.code, p.sortOrder]));
    return Array.from(base).sort(
      (a, b) => (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999) || a.localeCompare(b)
    );
  }

  ensureLoaded(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (!fs.existsSync(env.enLessonsDataPath)) {
      console.warn(`[FallbackStore] Không tìm thấy ${env.enLessonsDataPath}`);
      return;
    }

    try {
      const rawEn = JSON.parse(fs.readFileSync(env.enLessonsDataPath, 'utf8'));
      if (Array.isArray(rawEn)) {
        this.lessons = rawEn.map((l: any) => ({
          ...l,
          languageCode: 'en' as const,
          isSystem: true,
          ownerId: null,
        }));
      }
    } catch (err) {
      console.warn('[FallbackStore] Không đọc được bộ bài học Tiếng Anh A1:', err);
    }
  }
}

export const memoryStore = new FallbackMemoryStore();
