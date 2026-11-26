import { Router } from 'express';
import { PERMISSION_CODES } from '../config/rbacCatalog.js';
import { requirePermission } from '../middleware/auth.js';
import {
  listPermissionsCatalog,
  listRolesWithPermissions,
  listUsersWithRbac,
  saveUserPermissionOverrides,
  updateRolePermissions,
  updateUserRole,
} from '../repositories/rbacRepo.js';
import { runSoftDeleteRetentionPurge } from '../services/retentionService.js';

const router = Router();

router.get(
  '/rbac/catalog',
  requirePermission(
    PERMISSION_CODES.MENU_ADMIN,
    PERMISSION_CODES.USER_MANAGE,
    PERMISSION_CODES.ROLE_MANAGE
  ),
  async (_req, res, next) => {
    try {
      const [permissions, roles] = await Promise.all([
        listPermissionsCatalog(),
        listRolesWithPermissions(),
      ]);
      res.json({ permissions, roles });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/roles/:roleId/permissions',
  requirePermission(PERMISSION_CODES.ROLE_MANAGE),
  async (req, res, next) => {
    try {
      const roleId = String(req.params.roleId);
      if (roleId !== 'admin' && roleId !== 'user') {
        res.status(400).json({ error: 'Vai trò không hợp lệ (chỉ hỗ trợ admin hoặc user).' });
        return;
      }

      const { permissionIds } = req.body as { permissionIds?: string[] };
      if (!Array.isArray(permissionIds)) {
        res.status(400).json({ error: 'Danh sách permissionIds phải là mảng.' });
        return;
      }

      try {
        const role = await updateRolePermissions(roleId, permissionIds);
        res.json({ role });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/users',
  requirePermission(PERMISSION_CODES.USER_MANAGE, PERMISSION_CODES.ROLE_MANAGE),
  async (req, res, next) => {
    try {
      const keyword = typeof req.query.q === 'string' ? req.query.q : '';
      const users = await listUsersWithRbac(keyword);
      res.json({ users });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/users/:id/role',
  requirePermission(PERMISSION_CODES.USER_MANAGE),
  async (req, res, next) => {
    try {
      const targetId = String(req.params.id);
      const { role } = req.body as { role?: 'admin' | 'user' };
      if (role !== 'admin' && role !== 'user') {
        res.status(400).json({ error: 'Vai trò phải là admin hoặc user.' });
        return;
      }

      try {
        const updated = await updateUserRole(targetId, role, req.user!.userId);
        if (!updated) {
          res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
          return;
        }
        res.json({ user: updated });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/users/:id/permissions',
  requirePermission(PERMISSION_CODES.USER_MANAGE, PERMISSION_CODES.ROLE_MANAGE),
  async (req, res, next) => {
    try {
      const targetId = String(req.params.id);
      const { addedPermissions, excludedPermissions } = req.body as {
        addedPermissions?: string[];
        excludedPermissions?: string[];
      };

      try {
        const updated = await saveUserPermissionOverrides(
          targetId,
          Array.isArray(addedPermissions) ? addedPermissions : [],
          Array.isArray(excludedPermissions) ? excludedPermissions : [],
          req.user!.userId
        );
        if (!updated) {
          res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
          return;
        }
        res.json({ user: updated });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/maintenance/purge-soft-deleted',
  requirePermission(PERMISSION_CODES.MENU_ADMIN),
  async (req, res, next) => {
    try {
      const rawDays = Number((req.body as { retentionDays?: number } | undefined)?.retentionDays);
      const summary = await runSoftDeleteRetentionPurge(
        Number.isFinite(rawDays) && rawDays >= 1 ? Math.round(rawDays) : undefined
      );
      res.json(summary);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
