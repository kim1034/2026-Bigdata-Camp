import { Router } from 'express';
import { geminiService } from '../services/gemini.service';

export const extractRouter = Router();

extractRouter.post('/extract', async (req, res) => {
  try {
    const { image } = req.body;

    if (!image || typeof image !== 'string') {
      res.status(400).json({ error: '이미지 데이터가 누락되었습니다.' });
      return;
    }

    const data = await geminiService.extractPlaceFromImage(image);
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : '장소 분석에 실패했습니다. 잠시 후 다시 시도해주세요.';
    const status = message.includes('GEMINI_API_KEY') ? 503 : 500;
    res.status(status).json({ error: message });
  }
});
