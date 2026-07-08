import { Router } from 'express';
import { geminiService } from '../services/gemini.service';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'Hotplace Archive',
    backend: 'express',
    gemini: geminiService.ready,
  });
});
