import { Router } from 'express';
import { geminiService } from '../services/gemini.service';
import { buildFallbackItinerary } from '../services/planner.service';

export const itineraryRouter = Router();

itineraryRouter.post('/ai/itinerary', async (req, res) => {
  const places = Array.isArray(req.body?.places) ? req.body.places : [];
  if (places.length === 0) {
    res.status(400).json({
      error: 'EMPTY_PLACES',
      message: '일정표를 만들 장소가 필요합니다.',
    });
    return;
  }

  try {
    const itinerary = await geminiService.generateItinerary(req.body);
    res.json({ provider: 'gemini', itinerary });
  } catch (error) {
    console.error('[Gemini itinerary generation failed]', error);
    const fallbackItinerary = buildFallbackItinerary(req.body);
    res.json({
      provider: 'fallback',
      geminiError: error instanceof Error ? error.message : 'Gemini 일정 생성 실패',
      itinerary: fallbackItinerary,
    });
  }
});
