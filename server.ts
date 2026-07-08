import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createHttpServer } from 'http';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const httpServer = createHttpServer(app);

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ limit: '30mb', extended: true }));

type PlaceResult = {
  name: string;
  category: '카페' | '맛집' | '숙박' | '관광지';
  address: string;
  latitude: number;
  longitude: number;
  hours: string;
  menu: Array<{ name: string; price: string }>;
  reviewSummary: string;
  screenshotText: string;
  confidence: number;
  provider?: string;
};

function normalizeCategory(value: unknown): PlaceResult['category'] {
  const text = String(value || '');
  if (text.includes('맛') || text.includes('식') || text.includes('레스토랑')) return '맛집';
  if (text.includes('숙') || text.includes('호텔') || text.includes('펜션') || text.includes('스테이')) return '숙박';
  if (text.includes('관광') || text.includes('공원') || text.includes('전시') || text.includes('체험')) return '관광지';
  return '카페';
}

function normalizeMenu(value: unknown): Array<{ name: string; price: string }> {
  if (Array.isArray(value)) {
    return value.slice(0, 4).map((item) => {
      if (typeof item === 'string') return { name: item, price: '정보 없음' };
      return {
        name: String(item?.name || '대표 메뉴'),
        price: String(item?.price || '정보 없음'),
      };
    });
  }

  const text = String(value || '').trim();
  return text ? [{ name: text, price: '정보 없음' }] : [{ name: '대표 메뉴', price: '정보 없음' }];
}

function normalizePlaceResult(raw: any, fallbackText: string, provider: string): PlaceResult {
  return {
    name: String(raw?.name || '분석된 장소'),
    category: normalizeCategory(raw?.category),
    address: String(raw?.address || '주소 확인 필요'),
    latitude: Number(raw?.latitude) || 37.5446,
    longitude: Number(raw?.longitude) || 127.0559,
    hours: String(raw?.hours || '영업시간 확인 필요'),
    menu: normalizeMenu(raw?.menu),
    reviewSummary: String(raw?.reviewSummary || raw?.review_summary || '이미지 분석 결과를 바탕으로 저장된 장소입니다.'),
    screenshotText: String(raw?.screenshotText || raw?.screenshot_text || fallbackText || '캡처 이미지 분석 결과'),
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence) || 0.82)),
    provider,
  };
}

function inferMockPlace(text: string): PlaceResult {
  const value = text.toLowerCase();

  if (text.includes('숙소') || text.includes('스테이') || text.includes('한옥') || text.includes('펜션')) {
    return {
      name: value.includes('제주') ? '제주 감성 독채 펜션' : '스테이 한옥',
      category: '숙박',
      address: value.includes('제주') ? '제주 제주시 애월읍' : '서울 종로구 자하문로',
      latitude: value.includes('제주') ? 33.4631 : 37.5802,
      longitude: value.includes('제주') ? 126.3104 : 126.9691,
      hours: '체크인 15:00 / 체크아웃 11:00',
      menu: [{ name: '감성 숙소 1박', price: '320,000원' }],
      reviewSummary: '캡처 이미지에서 숙소 키워드를 감지해 조용한 숙박 코스로 분류했습니다.',
      screenshotText: text,
      confidence: 0.86,
      provider: 'mock',
    };
  }

  if (text.includes('맛집') || text.includes('식당') || text.includes('국수') || text.includes('덮밥') || text.includes('파스타')) {
    return {
      name: value.includes('한남') ? '한남동 퓨전 파스타' : '쵸리상경 성수',
      category: '맛집',
      address: value.includes('한남') ? '서울 용산구 한남동' : '서울 성동구 서울숲길 18',
      latitude: value.includes('한남') ? 37.5344 : 37.5471,
      longitude: value.includes('한남') ? 127.0008 : 127.0425,
      hours: '매일 11:00 - 21:30',
      menu: [
        { name: value.includes('파스타') ? '시그니처 파스타' : '갈릭 덮밥', price: '12,000원' },
        { name: value.includes('파스타') ? '글라스 와인' : '고기 국수', price: '14,000원' },
      ],
      reviewSummary: '식사 관련 키워드와 지역 맥락을 함께 보고 맛집으로 저장합니다.',
      screenshotText: text,
      confidence: 0.88,
      provider: 'mock',
    };
  }

  return {
    name: value.includes('onion') || text.includes('어니언') ? '어니언 성수' : '무브모브 성수',
    category: '카페',
    address: '서울 성동구 성수이로',
    latitude: 37.5438,
    longitude: 127.0569,
    hours: '매일 10:30 - 22:00',
    menu: [
      { name: '크림 라떼', price: '6,500원' },
      { name: '수제 케이크', price: '8,000원' },
    ],
    reviewSummary: '릴스 저장 반응이 높은 성수 디저트 카페로 자동 분류했습니다.',
    screenshotText: text,
    confidence: 0.93,
    provider: 'mock',
  };
}

function inferImagePrompt(image: string, promptHint = '') {
  const value = `${image} ${promptHint}`.toLowerCase();
  if (value.includes('607377') || value.includes('hotel') || value.includes('pension') || value.includes('제주')) {
    return '제주 감성 독채 펜션 숙소 캡처 OCR 결과';
  }
  if (value.includes('151724') || value.includes('restaurant') || value.includes('pasta') || value.includes('한남')) {
    return '한남동 퓨전 파스타 맛집 캡처 OCR 결과';
  }
  return '성수 대형 에스프레소 바 카페 캡처 OCR 결과';
}

function parseDataUriImage(image: string) {
  const match = image.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1] || 'image/jpeg',
    data: match[2],
  };
}

async function imageToInlineData(image: string) {
  const dataUri = parseDataUriImage(image);
  if (dataUri) return dataUri;

  if (/^https?:\/\//i.test(image)) {
    const response = await fetch(image);
    if (!response.ok) {
      throw new Error(`이미지를 불러오지 못했습니다. (${response.status})`);
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      mimeType: contentType.split(';')[0],
      data: buffer.toString('base64'),
    };
  }

  return {
    mimeType: 'image/jpeg',
    data: image,
  };
}

async function analyzeImageWithGemini(image: string, promptHint = '') {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되어 있지 않습니다.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const inlineData = await imageToInlineData(image);
  const model = process.env.GEMINI_MODEL || process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash';

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        inlineData,
      },
      {
        text: [
          '이 이미지는 인스타그램, 지도, 블로그, 장소 리뷰 캡처일 수 있습니다.',
          '이미지 안의 텍스트와 시각 정보를 분석해서 실제 방문 장소 후보를 추출하세요.',
          '한국어 JSON만 반환하세요. 마크다운 코드블록은 쓰지 마세요.',
          'JSON 필드: name, category, address, latitude, longitude, hours, menu, reviewSummary, screenshotText, confidence',
          'category는 반드시 카페, 맛집, 숙박, 관광지 중 하나로 쓰세요.',
          'menu는 [{ "name": "...", "price": "..." }] 배열로 쓰세요.',
          '좌표를 확실히 모르면 서울/한국 내 합리적인 추정 좌표를 넣고 confidence를 낮추세요.',
          promptHint ? `추가 힌트: ${promptHint}` : '',
        ].filter(Boolean).join('\n'),
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const text = response.text || '';
  const parsed = JSON.parse(text);
  return normalizePlaceResult(parsed, parsed?.screenshotText || promptHint, 'gemini');
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'PinSnap Archive',
    gemini: Boolean(process.env.GEMINI_API_KEY),
  });
});

app.post('/api/extract', async (req, res) => {
  const image = String(req.body?.image || '').trim();
  const text = String(req.body?.text || req.body?.prompt || '').trim();
  const promptHint = String(req.body?.promptHint || '').trim();

  if (image) {
    try {
      const place = await analyzeImageWithGemini(image, promptHint);
      res.json(place);
      return;
    } catch (error) {
      console.error('[Gemini image analysis failed]', error);
      const fallback = inferMockPlace(inferImagePrompt(image, promptHint));
      res.json({
        ...fallback,
        provider: 'mock-fallback',
        geminiError: error instanceof Error ? error.message : 'Gemini 분석 실패',
      });
      return;
    }
  }

  if (!text) {
    res.status(400).json({ error: '분석할 텍스트나 이미지가 필요합니다.' });
    return;
  }

  res.json({
    place: inferMockPlace(text),
    provider: process.env.GEMINI_API_KEY ? 'mock-ready-for-gemini' : 'mock',
  });
});

async function start() {
  if (isProduction) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[PinSnap Server] ${PORT} 포트가 이미 사용 중입니다.`);
      console.error('이미 켜진 dev 서버를 닫거나 .env에서 PORT=3001처럼 다른 포트를 지정해 주세요.');
      process.exit(1);
    }

    console.error(error);
    process.exit(1);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[PinSnap Server] http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
