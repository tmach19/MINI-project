import { Router, type RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, signToken } from '../middleware/auth.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  updateUserProfile,
} from '../repositories/userProgressRepo.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
    };

    if (!email?.trim() || !password || password.length < 6) {
      res.status(400).json({ error: 'Email hợp lệ và mật khẩu tối thiểu 6 ký tự là bắt buộc.' });
      return;
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'Email này đã được đăng ký.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser(email, passwordHash, displayName?.trim() || email.split('@')[0]);
    const token = signToken({ userId: user.id, email: user.email, role: user.role });

    res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email?.trim() || !password) {
      res.status(400).json({ error: 'Vui lòng nhập email và mật khẩu.' });
      return;
    }

    const found = await findUserByEmail(email);
    if (!found) {
      res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
      return;
    }

    const ok = await bcrypt.compare(password, found.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Email hoặc mật khẩu không đúng.' });
      return;
    }

    const token = signToken({ userId: found.id, email: found.email, role: found.role });
    const { passwordHash: _pw, ...user } = found;
    res.json({ token, user });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await findUserById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
      return;
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

function parseMediaField(raw: unknown, label: string, maxDataLength: number): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new Error(`${label} không hợp lệ.`);
  }
  const clean = raw.trim();
  if (!clean) return null;

  if (clean.startsWith('preset:')) {
    if (!/^preset:[a-z0-9-]+$/i.test(clean)) {
      throw new Error(`Mã mẫu ${label.toLowerCase()} không hợp lệ.`);
    }
    return clean;
  }

  if (/^https?:\/\//i.test(clean)) {
    if (clean.length > 2048) {
      throw new Error(`Đường dẫn ${label.toLowerCase()} quá dài.`);
    }
    return clean;
  }

  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(clean)) {
    if (clean.length > maxDataLength) {
      throw new Error(`${label} có dung lượng quá lớn, vui lòng chọn ảnh nhẹ hơn.`);
    }
    return clean;
  }

  throw new Error(`${label} phải là ảnh tải lên, mẫu có sẵn hoặc URL http(s) hợp lệ.`);
}

const handleUpdateProfile: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body || {}) as {
      displayName?: unknown;
      avatarUrl?: unknown;
      coverUrl?: unknown;
    };

    let cleanName: string | undefined;
    if (body.displayName !== undefined) {
      cleanName = String(body.displayName || '').trim().replace(/\s+/g, ' ');
      if (!cleanName || cleanName.length > 60) {
        res.status(400).json({ error: 'Tên hiển thị phải từ 1 đến 60 ký tự.' });
        return;
      }
    }

    let avatarUrl: string | null | undefined;
    let coverUrl: string | null | undefined;
    try {
      avatarUrl = parseMediaField(body.avatarUrl, 'Ảnh đại diện', 350_000);
      coverUrl = parseMediaField(body.coverUrl, 'Ảnh nền', 950_000);
    } catch (validationErr) {
      res.status(400).json({ error: (validationErr as Error).message });
      return;
    }

    if (cleanName === undefined && avatarUrl === undefined && coverUrl === undefined) {
      res.status(400).json({ error: 'Chưa có thông tin cần cập nhật.' });
      return;
    }

    const updated = await updateUserProfile(req.user!.userId, {
      displayName: cleanName,
      avatarUrl,
      coverUrl,
    });
    if (!updated) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
      return;
    }
    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
};

router.patch('/profile', requireAuth, handleUpdateProfile);
router.put('/profile', requireAuth, handleUpdateProfile);

export default router;
