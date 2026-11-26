import { env } from '../config/env.js';
import { memoryStore } from '../db/fallbackStore.js';
import { getDbMode, getPool } from '../db/pool.js';

export interface RetentionPurgeItem {
  tableName: string;
  purgedCount: number;
}

export interface RetentionPurgeSummary {
  retentionDays: number;
  totalPurged: number;
  details: RetentionPurgeItem[];
  ranAt: string;
}

/**
 * Dọn hẳn các bản ghi đã xoá mềm (is_deleted = 1) quá hạn retention (mặc định 30 ngày).
 */
export async function runSoftDeleteRetentionPurge(
  retentionDays = env.retention.softDeleteDays
): Promise<RetentionPurgeSummary> {
  const days = Math.max(1, Math.round(Number(retentionDays) || 30));
  const ranAt = new Date().toISOString();

  if (getDbMode() === 'memory') {
    memoryStore.ensureLoaded();
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

    let markedPurged = 0;
    for (const map of memoryStore.markedByUser.values()) {
      for (const [vocabId, rec] of map.entries()) {
        if (rec.isDeleted === 1 && rec.deletedAt && new Date(rec.deletedAt).getTime() < cutoffMs) {
          map.delete(vocabId);
          markedPurged += 1;
        }
      }
    }

    const beforeLessons = memoryStore.lessons.length;
    memoryStore.lessons = memoryStore.lessons.filter((l) => {
      if (l.isDeleted !== 1 || !l.deletedAt) return true;
      return new Date(l.deletedAt).getTime() >= cutoffMs;
    });
    const lessonsPurged = beforeLessons - memoryStore.lessons.length;

    const beforeGameScores = memoryStore.gameScores.length;
    memoryStore.gameScores = memoryStore.gameScores.filter((g) => {
      if (g.isDeleted !== 1 || !g.deletedAt) return true;
      return new Date(g.deletedAt).getTime() >= cutoffMs;
    });
    const gameScoresPurged = beforeGameScores - memoryStore.gameScores.length;

    const details: RetentionPurgeItem[] = [
      { tableName: 'user_marked_vocab', purgedCount: markedPurged },
      { tableName: 'game_scores', purgedCount: gameScoresPurged },
      { tableName: 'lessons', purgedCount: lessonsPurged },
    ];
    return {
      retentionDays: days,
      totalPurged: markedPurged + gameScoresPurged + lessonsPurged,
      details,
      ranAt,
    };
  }

  const pool = getPool()!;
  try {
    const res = await pool.query<{ table_name: string; purged_count: string | number }>(
      'SELECT table_name, purged_count FROM fn_purge_soft_deleted_records($1)',
      [days]
    );
    const details: RetentionPurgeItem[] = res.rows.map((r) => ({
      tableName: r.table_name,
      purgedCount: Number(r.purged_count || 0),
    }));
    const totalPurged = details.reduce((sum, item) => sum + item.purgedCount, 0);
    return { retentionDays: days, totalPurged, details, ranAt };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === '42883') {
      console.warn(
        '[Retention] Chưa thấy fn_purge_soft_deleted_records trên PostgreSQL -> bỏ qua cho tới khi chạy Liquibase.'
      );
      return { retentionDays: days, totalPurged: 0, details: [], ranAt };
    }
    throw err;
  }
}

let schedulerStarted = false;

export function startRetentionScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const intervalMs = Math.max(1, env.retention.purgeIntervalHours) * 60 * 60 * 1000;

  const execute = async () => {
    try {
      const summary = await runSoftDeleteRetentionPurge(env.retention.softDeleteDays);
      if (summary.totalPurged > 0) {
        console.log(
          `[Retention] Đã dọn ${summary.totalPurged} bản ghi xoá mềm quá ${summary.retentionDays} ngày.`
        );
      }
    } catch (err) {
      console.warn('[Retention] Lỗi khi dọn bản ghi xoá mềm:', (err as Error).message);
    }
  };

  // Chạy nhẹ sau khi server ổn định 15 giây, sau đó lặp theo chu kỳ
  const initialTimer = setTimeout(() => void execute(), 15_000);
  initialTimer.unref();

  const recurringTimer = setInterval(() => void execute(), intervalMs);
  recurringTimer.unref();
}
