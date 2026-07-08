# 🔐 Google OAuth 2.0 로그인 설정 가이드

## 📋 구현 완료 항목

### ✅ 설정 페이지 UI 구현
- [x] Settings 컴포넌트 생성 (`src/components/Settings.tsx`)
- [x] 사용자 프로필 표시
- [x] 프로필 수정 기능
- [x] 로그아웃 버튼
- [x] DB 검증 정보 표시

### ✅ Firestore 함수 구현
- [x] `getUserProfile()` - 사용자 프로필 로드
- [x] `saveUserProfile()` - 프로필 저장
- [x] UserProfile 타입 정의

### ✅ App 업데이트
- [x] Settings 탭 추가
- [x] Google OAuth 2.0 인증 로직

## 🔧 설정 단계

### 1️⃣ Google Cloud Console 설정

#### Step 1: Google Cloud 프로젝트 생성
```
1. https://console.cloud.google.com 접속
2. 상단 "프로젝트 선택" 클릭
3. "새 프로젝트" 클릭
4. 프로젝트 이름 입력 (예: "SpotLog-OAuth")
5. 생성 클릭 및 대기
```

#### Step 2: Google+ API 활성화
```
1. 왼쪽 메뉴 > "API 및 서비스" > "라이브러리"
2. "Google+ API" 검색
3. "Google+ API" 클릭 > "활성화" 클릭
```

#### Step 3: OAuth 동의 화면 구성
```
1. 왼쪽 메뉴 > "API 및 서비스" > "OAuth 동의 화면"
2. User Type: "외부" 선택 > "만들기" 클릭
3. 필드 작성:
   - 앱 이름: "SpotLog"
   - 사용자 지원 이메일: [your-email@gmail.com]
   - 개발자 연락처 정보: [your-email@gmail.com]
4. "저장 후 계속" 클릭
5. 범위 추가 (기본값 유지) > "저장 후 계속"
6. 테스트 사용자 추가 (선택사항) > 저장 후 계속
```

#### Step 4: OAuth 2.0 클라이언트 ID 생성
```
1. 왼쪽 메뉴 > "API 및 서비스" > "사용자 인증 정보"
2. "+ 사용자 인증 정보 만들기" > "OAuth 클라이언트 ID"
3. 애플리케이션 유형: "웹 애플리케이션" 선택
4. 이름: "SpotLog Web Client"
5. 승인된 자바스크립트 원본:
   ```
   http://localhost:3000
   http://localhost:5173
   https://your-domain.com (배포 시)
   ```
6. 승인된 리디렉션 URI:
   ```
   http://localhost:3000
   http://localhost:5173
   https://your-domain.com (배포 시)
   ```
7. "만들기" 클릭
8. **Client ID 복사** (중요!)
```

### 2️⃣ 환경 변수 설정

#### `.env` 파일 생성
```bash
# 프로젝트 루트에 .env 파일 생성
cp .env.example .env
```

#### `.env` 파일 수정
```env
# Google OAuth 2.0
VITE_GOOGLE_CLIENT_ID=your_google_client_id_from_console
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id_from_console

# Firebase 설정 (이미 있어야 함)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
# ... 기타 Firebase 환경변수
```

### 3️⃣ Firebase Firestore 보안 규칙 설정

#### Firestore 규칙 업데이트 (firestore.rules)
```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 사용자 프로필 - 본인만 접근
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    
    // 장소 데이터 - 로그인한 사용자만 접근
    match /workspaces/{workspace}/places/{doc=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

#### 규칙 배포
```bash
# Firebase CLI 사용
firebase deploy --only firestore:rules
```

## 🧪 테스트 방법

### 1️⃣ 개발 서버 시작
```bash
npm run dev
```

### 2️⃣ 설정 탭 접속
1. 웹 앱 열기 (http://localhost:3000 또는 5173)
2. 왼쪽 사이드바 하단의 "설정" (⚙️) 탭 클릭

### 3️⃣ 로그인 테스트
1. 상단 "클라우드 동기화" 섹션에서 "Sign in with Google" 버튼 클릭
2. Google 계정으로 로그인
3. 동의 화면 확인 후 승인

### 4️⃣ 프로필 확인
설정 탭에서 다음 항목 확인:
- ✓ Google 프로필 사진 표시
- ✓ 이메일 주소 표시
- ✓ 가입일 표시
- ✓ "Firestore에 프로필 저장됨" 메시지

### 5️⃣ 프로필 수정 테스트
1. "프로필 수정" 버튼 클릭
2. 표시 이름 수정 (예: "홍길동")
3. 소개글 입력 (예: "안녕하세요!")
4. "저장" 버튼 클릭
5. "프로필이 저장되었습니다! ✓" 메시지 확인

### 6️⃣ Firestore 데이터 확인
```
Firebase Console > Firestore Database > Collection 'users'
다음 구조 확인:
users
  └─ [uid]
      ├─ uid: "[user-id]"
      ├─ email: "[user-email]"
      ├─ displayName: "[수정된-이름]"
      ├─ photoURL: "[google-profile-image-url]"
      ├─ bio: "[입력한-소개글]"
      ├─ createdAt: "2026-07-08T..."
      └─ updatedAt: "2026-07-08T..."
```

### 7️⃣ 로그아웃 테스트
1. "계정 관리" 섹션에서 "로그아웃" 클릭
2. 로그인 화면으로 돌아가는지 확인

## 🐛 트러블슈팅

### 문제: "Sign in with Google" 버튼이 안 보임
**해결책:**
```
1. 개발자 도구 (F12) > Console 탭 확인
2. 에러 메시지 확인
3. .env 파일에서 GOOGLE_CLIENT_ID 확인
4. Google Cloud Console에서 승인된 자바스크립트 원본 확인
```

### 문제: "Failed to get credential" 에러
**해결책:**
```
1. Google Cloud Console > OAuth 2.0 클라이언트 ID 확인
2. Client ID가 올바른지 확인
3. 로컬호스트가 "승인된 자바스크립트 원본"에 포함되는지 확인
4. 캐시 삭제 후 페이지 새로고침 (Ctrl+Shift+R)
```

### 문제: Firestore에 데이터가 저장되지 않음
**해결책:**
```
1. Firebase Console > Firestore Rules 확인
2. 보안 규칙이 올바른지 확인
3. 로그인 상태 확인
4. 개발자 도구 Console에서 에러 메시지 확인
```

### 문제: CORS 에러
**해결책:**
```
1. Google Cloud Console > OAuth 동의 화면에서 테스트 사용자 추가
2. localhost 또는 실제 도메인이 승인된 자바스크립트 원본에 포함되는지 확인
3. 서버 재시작
```

## 📊 데이터 흐름

```
사용자 로그인 (Google OAuth 2.0)
    ↓
Firebase Authentication에서 검증
    ↓
Settings 탭 > getUserProfile(uid)
    ↓
Firestore에서 프로필 조회
    ↓
프로필 없으면 새로 생성 및 저장
    ↓
UI에 프로필 표시
    ↓
사용자 수정 가능 (이름, 소개글)
    ↓
저장 버튼 클릭 > saveUserProfile()
    ↓
Firestore 'users' Collection에 저장
    ↓
저장 완료 메시지 표시
```

## 📝 파일 구조

```
src/
├─ components/
│  └─ Settings.tsx (NEW) - 설정 UI 컴포넌트
├─ services/
│  └─ firebaseDb.ts (UPDATED) - 사용자 프로필 함수 추가
├─ types.ts (UPDATED) - UserProfile 타입 추가
└─ App.tsx (UPDATED) - Settings 탭 추가

.env.example (UPDATED) - Google OAuth 환경변수 추가
```

## 🚀 배포 시 주의사항

### 환경 변수
```env
# 프로덕션 Google OAuth Client ID (웹 애플리케이션)
VITE_GOOGLE_CLIENT_ID=your_production_client_id
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your_production_client_id

# Google Cloud Console에서 승인된 도메인 추가
- your-domain.com
- www.your-domain.com
- api.your-domain.com
```

### Firestore 규칙
- 프로덕션 규칙 반영 완료
- 사용자만 자신의 프로필 접근 가능
- 적절한 접근 제어 유지

## ✨ 주요 기능

| 기능 | 설명 | 위치 |
|------|------|------|
| 🔐 Google Sign-In | OAuth 2.0 기반 로그인 | 클라우드 동기화 섹션 |
| 👤 프로필 표시 | Google 프로필 사진, 이름, 이메일 | 설정 탭 |
| ✏️ 프로필 수정 | 표시 이름, 소개글 수정 | 설정 탭 > 프로필 수정 |
| 💾 Firestore 저장 | 프로필 자동 저장 | Firestore users collection |
| 🔍 DB 검증 | 저장 상태 및 UID 표시 | 설정 탭 하단 |
| 🚪 로그아웃 | Firebase 로그아웃 | 설정 탭 > 계정 관리 |

## 🎯 완료 체크리스트

- [x] Settings 컴포넌트 구현
- [x] Google OAuth 2.0 로그인 연동
- [x] Firestore 사용자 프로필 저장
- [x] 프로필 수정 기능
- [x] 로그아웃 기능
- [x] TypeScript 타입 정의
- [x] 환경 변수 설정
- [x] 보안 규칙 가이드
- [ ] Google Cloud 설정 (사용자가 수행)
- [ ] .env 파일 생성 (사용자가 수행)

---

**문의사항이 있으신가요?** 설정 후 테스트하실 때 문제가 생기면 알려주세요! 🚀
