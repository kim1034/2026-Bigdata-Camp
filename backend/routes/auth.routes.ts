import { Router } from 'express';
import { loginPasswordUser, registerPasswordUser } from '../services/auth.service';

export const authRouter = Router();

authRouter.post('/auth/register', async (req, res) => {
  try {
    const user = await registerPasswordUser({
      userId: String(req.body?.userId || ''),
      password: String(req.body?.password || ''),
      nickname: String(req.body?.nickname || ''),
      age: Number(req.body?.age),
      gender: String(req.body?.gender || 'none'),
    });

    res.status(201).json({
      provider: 'password',
      user,
      workspaceId: user.workspaceId,
      signedInAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({
      error: 'REGISTER_FAILED',
      message: error instanceof Error ? error.message : '회원가입에 실패했습니다.',
    });
  }
});

authRouter.post('/auth/login', async (req, res) => {
  try {
    const user = await loginPasswordUser({
      userId: String(req.body?.userId || ''),
      password: String(req.body?.password || ''),
    });

    res.json({
      provider: 'password',
      user,
      workspaceId: user.workspaceId,
      signedInAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(401).json({
      error: 'LOGIN_FAILED',
      message: error instanceof Error ? error.message : '로그인에 실패했습니다.',
    });
  }
});
