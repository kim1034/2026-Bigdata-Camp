import { GoogleGenAI, Type } from '@google/genai';
import { env } from '../config/env';

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export class GeminiService {
  private readonly client: GoogleGenAI | null;

  constructor() {
    if (!env.geminiApiKey || env.geminiApiKey === 'MY_GEMINI_API_KEY') {
      this.client = null;
      return;
    }

    this.client = new GoogleGenAI({
      apiKey: env.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'pinsnap-hotplace-archive',
        },
      },
    });
  }

  get ready() {
    return Boolean(this.client);
  }

  async extractPlaceFromImage(image: string) {
    if (!this.client) {
      throw new Error('GEMINI_API_KEY가 설정되지 않아 이미지 분석을 수행할 수 없습니다.');
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeType = image.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/png';

    const response = await this.client.models.generateContent({
      model: env.geminiModel,
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        {
          text: [
            '너는 한국 핫플레이스 캡처 이미지를 분석하는 OCR 및 장소 추론 엔진이야.',
            '인스타그램, 블로그, 지도, 채팅 캡처에서 보이는 텍스트를 읽고 실제 방문 장소를 추론해.',
            '장소명, 카테고리, 주소, 좌표, 영업시간, 대표 메뉴, 리뷰 요약, 근거 텍스트를 JSON으로만 반환해.',
            '좌표는 반드시 대한민국 범위 안이어야 해. 위도는 35.0~38.5, 경도는 126.0~129.5 근처여야 해.',
            '카테고리는 정확히 "카페", "맛집", "숙박", "관광지/기타" 중 하나로 골라.',
            '모호한 경우 캡처 텍스트와 지역 단서를 조합해서 가장 가능성 높은 Google Places 스타일의 결과를 만들어.',
          ].join('\n'),
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: '장소 이름' },
            category: { type: Type.STRING, description: '카페, 맛집, 숙박, 관광지/기타 중 하나' },
            address: { type: Type.STRING, description: '대한민국 도로명 주소' },
            latitude: { type: Type.NUMBER, description: '대한민국 위도' },
            longitude: { type: Type.NUMBER, description: '대한민국 경도' },
            hours: { type: Type.STRING, description: '영업시간' },
            menu: {
              type: Type.ARRAY,
              description: '대표 메뉴 2~3개',
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  price: { type: Type.STRING },
                },
                required: ['name', 'price'],
              },
            },
            reviewSummary: { type: Type.STRING, description: '리뷰 요약 2~3문장' },
            screenshotText: { type: Type.STRING, description: '장소 추론 근거가 된 OCR 텍스트' },
          },
          required: ['name', 'category', 'address', 'latitude', 'longitude', 'hours', 'menu', 'reviewSummary', 'screenshotText'],
        },
      },
    });

    const jsonText = response.text?.trim();
    if (!jsonText) {
      throw new Error('Gemini가 빈 응답을 반환했습니다.');
    }

    const data = JSON.parse(jsonText);
    data.latitude = Number(data.latitude);
    data.longitude = Number(data.longitude);

    if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) {
      throw new Error(`Gemini 응답 좌표가 올바르지 않습니다: ${data.latitude}, ${data.longitude}`);
    }

    return data;
  }

  async generateItinerary(payload: any) {
    if (!this.client) {
      throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    }

    const places = Array.isArray(payload?.places) ? payload.places : [];
    const basePlace = payload?.basePlace || null;
    const visitDate = String(payload?.visitDate || '');

    const response = await this.client.models.generateContent({
      model: env.geminiModel,
      contents: [
        {
          text: [
            '너는 한국 여행 일정표를 만드는 모바일 앱의 AI 플래너야.',
            '기준점에서 가까운 순서로 정렬된 장소 목록을 바탕으로 하루 일정표를 만들어줘.',
            '영업시간, 점심/카페 타이밍, 이동 거리, 체류 시간을 자연스럽게 반영해.',
            '반드시 JSON만 반환하고 마크다운 코드블록은 쓰지 마.',
            'JSON 필드: title, summary, steps',
            'steps 배열의 각 항목 필드: time, placeName, category, activity, duration, hoursStatus, tip, moveToNext',
            '마지막 장소의 moveToNext는 빈 문자열로 두고, 이동 문구는 "도보 이동 7분 (547m)"처럼 작성해.',
            `방문 예정일: ${visitDate}`,
            `기준점: ${basePlace ? JSON.stringify(basePlace) : '사용자가 입력한 기준점 없음'}`,
            `장소 목록: ${JSON.stringify(places)}`,
          ].join('\n'),
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = safeJsonParse(response.text || '');
    if (!parsed) {
      throw new Error('Gemini 일정표 응답을 JSON으로 해석하지 못했습니다.');
    }

    return parsed;
  }
}

export const geminiService = new GeminiService();
