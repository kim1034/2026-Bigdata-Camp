import { Router } from 'express';
import { getRealtimeTransit } from '../services/transit.service';

export const transitRouter = Router();

transitRouter.post('/transit/realtime', async (req, res) => {
  try {
    const realtime = await getRealtimeTransit(req.body);
    res.json(realtime);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      provider: 'TAGO',
      message: error instanceof Error ? error.message : '실시간 대중교통 정보를 불러오지 못했습니다.',
      bus: { status: 'error', message: 'TAGO 호출 실패', buses: [] },
      subway: { status: 'missing-config', message: '실시간 지하철 API가 설정되지 않았습니다.', trains: [] },
      transitSteps: Array.isArray(req.body?.transitSteps) ? req.body.transitSteps : [],
    });
  }
});
