# ⚡ Google OAuth 2.0 로그인 - 빠른 시작 가이드

## ✅ 구현 완료 확인

### 코드 구현 상태:
```
✅ Settings 컴포넌트 생성 (src/components/Settings.tsx)
✅ Firestore 함수 추가 (src/services/firebaseDb.ts)
✅ App.tsx 업데이트 (Settings 탭 추가)
✅ 타입 정의 (src/types.ts)
✅ TypeScript 컴파일 성공
✅ 환경 변수 설정 (.env.example)
```

## 🚀 3단계로 시작하기

### Step 1️⃣: Google Cloud 설정 (10분)

#### 1-1. Google Cloud Console 접속
```
https://console.cloud.google.com
```

#### 1-2. 새 프로젝트 생성
```
프로젝트 선택 → 새 프로젝트 → 이름 입력 (예: "SpotLog-OAuth")
```

#### 1-3. Google+ API 활성화
```
API 및 서비스 → 라이브러리 → "Google+ API" 검색 → 활성화
```

#### 1-4. OAuth 동의 화면 설정
```
API 및 서비스 → OAuth 동의 화면
1. User Type: 외부 선택
2. 앱 이름: SpotLog
3. 사용자 지원 이메일: [your-email]
4. 개발자 연락처: [your-email]
5. 저장 후 계속
```

#### 1-5. OAuth 2.0 클라이언트 ID 생성
```
API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID
1. 애플리케이션 유형: 웹 애플리케이션
2. 이름: SpotLog Web Client
3. 승인된 자바스크립트 원본:
   - http://localhost:3000
   - http://localhost:5173
4. 승인된 리디렉션 URI:
   - http://localhost:3000
   - http://localhost:5173
5. 만들기 → Client ID 복사 ⭐
```

### Step 2️⃣: 환경 변수 설정 (2분)

#### 2-1. `.env` 파일 생성
```bash
# 프로젝트 루트에서 실행
cp .env.example .env
```

#### 2-2. `.env` 파일 편집
```env
# Step 1-5에서 복사한 Client ID를 아래에 입력
VITE_GOOGLE_CLIENT_ID=your_copied_client_id_here
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your_copied_client_id_here

# 기존 Firebase 환경변수 유지
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
# ... 기타 설정
```

### Step 3️⃣: 테스트 (5분)

#### 3-1. 개발 서버 시작
```bash
npm run dev
```

#### 3-2. 웹 브라우저에서 열기
```
http://localhost:3000 또는 http://localhost:5173
```

#### 3-3. Settings 탭 테스트
```
1. 왼쪽 사이드바에서 "설정" (⚙️) 탭 클릭
2. 상단에 "Sign in with Google" 버튼 보임
3. 버튼 클릭 → Google 로그인 → 동의
4. 프로필 정보 표시되는지 확인
5. 프로필 수정 → 저장 테스트
6. 로그아웃 테스트
```

## 📊 테스트 결과 확인

### 콘솔에서 확인 (브라우저 F12 개발자 도구)
```
✓ 프로필 로드됨: "[User Profile Loaded]"
✓ 프로필 저장됨: "[User Profile Saved]"
✓ 에러 없음
```

### Firestore 데이터 확인
```
Firebase Console
→ Firestore Database
→ Collection: users
→ Document: [사용자 UID]
```

다음과 같은 데이터가 있어야 함:
```json
{
  "uid": "abc123...",
  "email": "user@gmail.com",
  "displayName": "홍길동",
  "photoURL": "https://...",
  "bio": "안녕하세요!",
  "createdAt": "2026-07-08T...",
  "updatedAt": "2026-07-08T..."
}
```

## 🐛 문제 해결

### "Sign in with Google" 버튼이 안 보임
```
1. 개발자 도구 Console 확인
2. .env 파일에서 GOOGLE_CLIENT_ID 확인
3. 브라우저 캐시 삭제 (Ctrl+Shift+R)
4. 서버 재시작 (npm run dev)
```

### "Failed to get credential" 에러
```
1. Google Cloud Console 에서 Client ID 확인
2. 승인된 자바스크립트 원본에 localhost 포함되는지 확인
3. .env 파일의 Client ID가 올바른지 확인
```

### Firestore에 데이터가 저장되지 않음
```
1. Firebase Console > Firestore Rules 확인
2. 사용자가 로그인 상태인지 확인
3. 개발자 도구 Console에서 에러 확인
```

## 📚 상세 문서

- **OAUTH_SETUP_GUIDE.md** - 상세한 설정 가이드
- **IMPLEMENTATION_SUMMARY.md** - 구현 완료 보고서
- **코드 주석** - 각 파일의 주석 참고

## 🎯 체크리스트

### 설정 전:
- [ ] Google 계정 준비
- [ ] 인터넷 연결 확인

### Google Cloud 설정:
- [ ] Google Cloud Console 접속
- [ ] 프로젝트 생성
- [ ] Google+ API 활성화
- [ ] OAuth 동의 화면 구성
- [ ] OAuth 클라이언트 ID 생성
- [ ] Client ID 복사

### 로컬 설정:
- [ ] `.env` 파일 생성
- [ ] Client ID 입력
- [ ] Firebase 환경변수 확인

### 테스트:
- [ ] `npm run dev` 실행
- [ ] Settings 탭 클릭
- [ ] Google로 로그인
- [ ] 프로필 표시 확인
- [ ] 프로필 수정 테스트
- [ ] Firestore 데이터 확인
- [ ] 로그아웃 테스트

## 💡 팁

### Client ID를 잃어버렸을 때:
```
Google Cloud Console → API 및 서비스 → 사용자 인증 정보
→ OAuth 2.0 클라이언트 ID 클릭 → Client ID 확인
```

### 개발 중에 Client ID 변경해야 할 때:
```
1. Google Cloud Console에서 새 클라이언트 ID 생성
2. .env 파일에서 기존 ID 대체
3. 서버 재시작 (npm run dev)
```

### 모바일 테스트 (Expo):
```
기존 웹과 동일한 설정으로 모바일에서도 작동합니다.
EXPO_PUBLIC_GOOGLE_CLIENT_ID도 동일하게 설정하면 됩니다.
```

## 🚀 배포 전 확인

### 프로덕션 환경 변수:
```env
# production Google OAuth Client ID (별도로 생성해야 함)
VITE_GOOGLE_CLIENT_ID=your_production_client_id
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your_production_client_id
```

### Google Cloud 설정:
```
API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID 수정
승인된 자바스크립트 원본에 프로덕션 도메인 추가:
- https://your-domain.com
- https://www.your-domain.com
```

### Firestore 보안 규칙:
```
Firebase Console → Firestore Database → 규칙
아래 규칙 적용 후 배포:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    match /workspaces/{workspace}/places/{doc=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## ✨ 완료!

축하합니다! 🎉 Google OAuth 2.0 로그인이 준비되었습니다!

**다음:**
1. Step 1-3 진행
2. Client ID 복사
3. `.env` 파일 설정
4. `npm run dev` 실행
5. Settings 탭에서 테스트

**문제가 있나요?** OAUTH_SETUP_GUIDE.md의 "트러블슈팅" 섹션을 참고하세요!

---

**Happy Coding! 💻**
