import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, signToken } from '../middleware/auth.js';
import { createUser, findUserByEmail, findUserById } from '../repositories/userProgressRepo.js';

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

export default router;
