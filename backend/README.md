# Backend Role Split

프로젝트 루트 안에서 프론트엔드와 백엔드를 나누기 위한 Express 백엔드입니다.

## 담당 범위

- `routes/`: 모바일 앱과 웹 프론트가 호출하는 REST API 엔드포인트
- `services/gemini.service.ts`: 캡처 이미지 장소 분석, AI 일정표 생성
- `services/routing.service.ts`: Google Directions 기반 도보/자전거/대중교통 경로 탐색
- `services/transit.service.ts`: TAGO 버스 실시간 위치 조회
- `config/env.ts`: `.env` 로딩과 서버 전용 환경변수 정리
- `server.ts`: Vite 개발 서버 연결, 프로덕션 정적 파일 서빙, 포트 에러 처리

## 현재 API

- `GET /api/health`
- `POST /api/extract`
- `POST /api/ai/itinerary`
- `POST /api/routes/smart-plan`
- `POST /api/routes/multi-modal`
- `POST /api/transit/realtime`

프론트엔드는 UI, 지도 조작, 사용자 입력, 로컬 상태를 담당하고 백엔드는 API 키가 필요한 외부 호출과 AI 처리만 맡습니다.
