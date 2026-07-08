# Hotplace Archive

SNS 캡처 이미지나 텍스트에서 장소를 추출하고, 지도 저장, 컬렉션, 스마트 동선, AI 일정표까지 연결하는 핫플 아카이브 앱입니다.

## 프로젝트 구조

- `backend/`: Express 백엔드. Gemini, Google Directions, TAGO 등 API 키가 필요한 서버 기능을 담당합니다.
- `server.ts`: 루트 실행 진입점. `backend/server.ts`를 호출합니다.
- `src/`: 웹 프론트엔드입니다.
- `mobile/`: Expo Go에서 실행하는 React Native 앱입니다.
- `firestore.rules`, `firebase.json`: Firebase Firestore 설정입니다.
- `ppt-features.md`: 발표자료에 넣을 수 있는 기능 설명 요약입니다.

## 역할 분담

프론트엔드:

- 화면 UI, 지도 조작, 바텀시트, 탭, 컬렉션 UI
- 사용자 입력과 앱 상태 관리
- Expo Go 실행 및 모바일 기기 테스트

백엔드:

- `POST /api/extract`: 캡처 이미지 기반 Gemini 장소 분석
- `POST /api/ai/itinerary`: Gemini 기반 AI 일정표 생성
- `POST /api/routes/multi-modal`: Google Directions 기반 도보/자전거/대중교통 경로 탐색
- `POST /api/transit/realtime`: TAGO 버스 실시간 위치 조회
- `GET /api/health`: 서버 상태 확인

## 루트 서버 실행

```bash
npm install
npm run dev
```

기본 주소는 `http://localhost:3000`입니다. 이미 3000 포트가 사용 중이면 `.env`에서 포트를 바꿔주세요.

```env
PORT=3001
```

## Expo Go 실행

루트에서 실행:

```bash
npm run mobile
```

또는 모바일 폴더에서 직접 실행:

```bash
cd mobile
npx expo start
```

휴대폰 Expo Go에서 보려면 `mobile/.env`의 `EXPO_PUBLIC_API_BASE_URL`을 `localhost`가 아니라 PC의 같은 Wi-Fi IP로 맞춰야 합니다.

```env
EXPO_PUBLIC_API_BASE_URL=http://172.30.1.45:3000
```

## 계정 로그인 설정

설정 탭에서 아이디와 비밀번호로 로그인하거나 회원가입할 수 있습니다. 회원가입 시 닉네임, 나이, 성별을 입력받고, 백엔드의 `POST /api/auth/register`가 Firestore `users/{userId}` 문서에 저장합니다. 비밀번호는 평문이 아니라 `scrypt` 해시와 salt만 저장합니다.

로그인은 `POST /api/auth/login`을 사용하며, 성공하면 응답의 `workspaceId` 기준으로 장소와 컬렉션 데이터를 분리해서 불러옵니다.

모바일 앱은 서버 주소가 필요합니다.

```env
EXPO_PUBLIC_API_BASE_URL=http://PC_IP:3000
```

## 주요 환경변수

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

GOOGLE_DIRECTIONS_API_KEY=
GOOGLE_MAPS_API_KEY=
EXPO_PUBLIC_GOOGLE_MAPS_JAVASCRIPT_API_KEY=

TAGO_BUS_SERVICE_KEY=
TAGO_BUS_CITY_CODE=
TAGO_BUS_ROUTE_ID=

EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
EXPO_PUBLIC_FIREBASE_WORKSPACE_ID=default
```

## 빌드

```bash
npm run build
npm run start
```

`npm run build`는 웹 프론트엔드와 루트 백엔드 엔트리를 함께 빌드합니다.

## Firebase DB

현재 앱은 Firestore에 장소와 컬렉션을 저장합니다.

저장 경로:

```text
users/{userId}
workspaces/{EXPO_PUBLIC_FIREBASE_WORKSPACE_ID}/places/{placeId}
workspaces/{EXPO_PUBLIC_FIREBASE_WORKSPACE_ID}/collections/{collectionId}
```

현재 `firestore.rules`는 MVP 테스트용 공개 규칙입니다. 실제 배포 전에는 Firebase Auth 기반 규칙으로 바꿔야 합니다.
