import { Router } from 'express';
import { registerExpoPushToken } from '../services/push.service';

export const notificationsRouter = Router();

notificationsRouter.post('/notifications/push-token', async (req, res) => {
  try {
    const token = await registerExpoPushToken({
      userId: String(req.body?.userId || ''),
      token: String(req.body?.token || ''),
      platform: String(req.body?.platform || ''),
    });
    res.status(201).json({ token });
  } catch (error) {
    res.status(400).json({
      error: 'PUSH_TOKEN_REGISTER_FAILED',
      message: error instanceof Error ? error.message : '푸시 토큰 등록에 실패했습니다.',
    });
  }
});
