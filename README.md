# PinSnap Archive

SNS에서 발견한 핫플을 캡처 이미지/텍스트로 분석하고, 카테고리 지도와 스마트 동선, 일정표로 정리하는 장소 큐레이션 앱입니다.

## 폴더 구조

- `src/`, `server.ts`: Vite + React 웹 프로토타입
- `mobile/`: Expo Go에서 확인하는 React Native 모바일 프로토타입

## 웹 실행

루트 폴더에서 실행합니다.

```bash
npm install
npm run dev
```

기본 주소는 `http://localhost:3000`입니다. 이미 dev 서버가 켜져 있으면 `3000` 포트 충돌이 날 수 있습니다. 이때는 기존 터미널을 종료하거나 `.env`에 다른 포트를 지정하세요.

```env
PORT=3001
```

## Gemini 캡처 분석

캡처 이미지 분석은 루트 서버의 `/api/extract`에서 Gemini API를 호출합니다.

필수 환경변수:

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

정상 동작하면 `/api/extract` 응답에 다음 값이 포함됩니다.

```json
{ "provider": "gemini" }
```

Gemini 호출에 실패하면 앱은 `mock-fallback` 또는 `local-fallback` 결과를 보여줍니다.

## Expo Go 실행

Expo 앱은 루트가 아니라 `mobile/` 폴더에 있습니다. 따라서 루트에서 `npx expo start`를 실행하면 안 됩니다.

루트에서 바로 실행:

```bash
npm run mobile
```

고정 포트 실행:

```bash
npm run mobile:8083
```

직접 `mobile/` 폴더에서 실행:

```bash
cd mobile
npx expo start
```

Expo Go를 휴대폰에서 볼 때 `mobile/.env`의 `EXPO_PUBLIC_API_BASE_URL`은 `localhost`가 아니라 PC의 같은 Wi-Fi IP를 가리켜야 합니다.

예시:

```env
EXPO_PUBLIC_API_BASE_URL=http://172.30.1.45:3000
```

실제 지도는 `mobile/.env`의 `EXPO_PUBLIC_GOOGLE_MAPS_JAVASCRIPT_API_KEY`를 사용합니다.

## 주요 기능

- 인스타/지도 캡처 이미지 업로드 기반 Gemini 장소 분석
- 캡션 텍스트 기반 장소 자동 추론 데모
- Google Maps JavaScript API 기반 실제 지도와 카테고리별 마커
- 장소 상세 카드와 영업시간/대표 메뉴 표시
- 가까운 순서 기반 스마트 동선 생성
- 하루 일정표 자동 구성

## Firebase DB

Firebase 설정이 있으면 웹 앱의 장소 데이터가 Firestore에 동기화됩니다.

저장 경로:

```text
workspaces/{EXPO_PUBLIC_FIREBASE_WORKSPACE_ID 또는 VITE_FIREBASE_WORKSPACE_ID}/places/{placeId}
```

필요한 클라이언트 환경변수:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_FIREBASE_WORKSPACE_ID=default
```

`firestore.rules`는 MVP 테스트용 공개 규칙입니다. 실제 배포 전에는 Firebase Auth 기반 규칙으로 바꿔야 합니다.
