import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { findUserById } from '../repositories/userProgressRepo.js';
import type { UserProfile } from '../types/domain.js';

export interface AuthPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      currentUser?: UserProfile;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7);
    try {
      const decoded = jwt.verify(token, env.jwtSecret) as AuthPayload;
      req.user = decoded;
    } catch {
      // Token không hợp lệ thì coi như khách
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Bạn cần đăng nhập để thực hiện thao tác này.' });
    return;
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, env.jwtSecret) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
  }
}

/**
 * Kiểm tra quyền theo mô hình ICDS:
 * - Super Admin (role === 'admin' / isSuperAdmin) luôn bypass
 * - Mảng rỗng => cho qua
 * - Cơ chế OR: chỉ cần user sở hữu ít nhất 1 mã quyền trong requiredCodes
 */
export function hasUserPermission(user: UserProfile, requiredCodes: string[]): boolean {
  if (user.isSuperAdmin || user.role === 'admin') return true;
  if (requiredCodes.length === 0) return true;
  return requiredCodes.some((code) => user.permissions.includes(code));
}

export async function resolveCurrentUser(req: Request): Promise<UserProfile | null> {
  if (!req.user) return null;
  if (req.currentUser) return req.currentUser;
  const user = await findUserById(req.user.userId);
  if (user) req.currentUser = user;
  return user;
}

export function requirePermission(...requiredCodes: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        const header = req.headers.authorization;
        if (!header || !header.startsWith('Bearer ')) {
          res.status(401).json({ error: 'Bạn cần đăng nhập để thực hiện thao tác này.' });
          return;
        }
        try {
          req.user = jwt.verify(header.slice(7), env.jwtSecret) as AuthPayload;
        } catch {
          res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
          return;
        }
      }

      const user = await resolveCurrentUser(req);
      if (!user) {
        res.status(401).json({ error: 'Tài khoản không tồn tại hoặc đã bị vô hiệu hoá.' });
        return;
      }

      if (!hasUserPermission(user, requiredCodes)) {
        res.status(403).json({
          error: 'Bạn không có quyền thực hiện chức năng này.',
          requiredPermissions: requiredCodes,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
