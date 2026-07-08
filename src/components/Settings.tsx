import React, { useState, useEffect } from "react";
import { User, Mail, Calendar, LogOut, Check, AlertCircle, Loader } from "lucide-react";
import type { User as FirebaseUser } from "firebase/auth";
import { GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut, onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "../services/firebaseDb";
import { getUserProfile, saveUserProfile, type UserProfile } from "../services/firebaseDb";

interface SettingsProps {
  user: FirebaseUser | null;
}

export default function Settings({ user: propUser }: SettingsProps) {
  // Use local currentUser state to detect login changes independently
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const user = currentUser ?? propUser; // Prefer local state
  
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  // Profile edit states
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // Listen for auth state changes independently
  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      console.log("Settings: Auth state changed", firebaseUser?.email);
      setCurrentUser(firebaseUser);
    });

    return () => unsubscribe();
  }, []);

  // Initialize Google Identity Services in Settings
  useEffect(() => {
    let cancelled = false;

    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
    const clientId = env.VITE_GOOGLE_CLIENT_ID || env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || "";

    if (!clientId) {
      setMessage({ type: "error", text: "VITE_GOOGLE_CLIENT_ID가 비어 있습니다. .env 설정을 확인하세요." });
      return;
    }

    const initGoogleSignInSettings = () => {
      if (cancelled) return;

      const g = (window as any).google;
      if (!g?.accounts?.id) return;

      const marker = "__pinsnapGoogleClientId";
      if ((window as any)[marker] !== clientId) {
        g.accounts.id.initialize({
          client_id: clientId,
          callback: async (response: any) => {
            try {
              if (!response?.credential) {
                setMessage({ type: "error", text: "Google 자격 증명을 받지 못했습니다." });
                return;
              }

              const auth = getFirebaseAuth();
              if (!auth) {
                setMessage({ type: "error", text: "Firebase 인증이 초기화되지 않았습니다." });
                return;
              }

              const credential = GoogleAuthProvider.credential(response.credential);
              const result = await signInWithCredential(auth, credential);

              const profile = await getUserProfile(result.user.uid);
              if (!profile) {
                const newProfile: UserProfile = {
                  uid: result.user.uid,
                  email: result.user.email || "",
                  displayName: result.user.displayName || "사용자",
                  photoURL: result.user.photoURL || "",
                  bio: "",
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                await saveUserProfile(newProfile);
                setUserProfile(newProfile);
                setDisplayName(newProfile.displayName);
              } else {
                setUserProfile(profile);
                setDisplayName(profile.displayName);
              }

              setMessage({ type: "success", text: "로그인 성공! ✓" });
              setTimeout(() => setMessage(null), 2000);
            } catch (error: any) {
              console.error("Google Sign-In credential exchange failed:", error);
              const errorCode = error?.code as string | undefined;

              if (errorCode === "auth/configuration-not-found") {
                setMessage({
                  type: "error",
                  text: "Firebase 콘솔에서 Authentication > Sign-in method > Google 제공업체를 활성화하세요.",
                });
                return;
              }

              if (errorCode === "auth/invalid-credential") {
                setMessage({
                  type: "error",
                  text: "Google Client ID와 Firebase 프로젝트 설정이 서로 일치하지 않습니다.",
                });
                return;
              }

              const errorMsg = error instanceof Error ? error.message : String(error);
              setMessage({ type: "error", text: `로그인 실패: ${errorMsg}` });
            }
          },
          auto_select: false,
        });
        (window as any)[marker] = clientId;
      }

      const buttonDiv = document.getElementById("google-signin-btn-settings");
      if (buttonDiv) {
        buttonDiv.innerHTML = "";
        g.accounts.id.renderButton(buttonDiv, {
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
        });
      }
    };

    const interval = window.setInterval(() => {
      const g = (window as any).google;
      if (g?.accounts?.id) {
        initGoogleSignInSettings();
        window.clearInterval(interval);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // Load user profile from Firestore
  useEffect(() => {
    const loadProfile = async () => {
      console.log("loadProfile called, user:", user?.email);
      if (!user) {
        console.log("No user, skipping profile load");
        return;
      }
      
      setIsLoading(true);
      try {
        console.log("Fetching profile for uid:", user.uid);
        const profile = await getUserProfile(user.uid);
        console.log("Profile fetched:", profile);
        
        if (profile) {
          console.log("Using existing profile");
          setUserProfile(profile);
          setDisplayName(profile.displayName || user.displayName || "");
          setBio(profile.bio || "");
        } else {
          // Create new profile if doesn't exist
          console.log("Creating new profile");
          const newProfile: UserProfile = {
            uid: user.uid,
            email: user.email || "",
            displayName: user.displayName || "사용자",
            photoURL: user.photoURL || "",
            bio: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          console.log("Saving new profile:", newProfile);
          await saveUserProfile(newProfile);
          console.log("Profile saved successfully");
          setUserProfile(newProfile);
          setDisplayName(newProfile.displayName);
        }
        setMessage(null);
      } catch (error) {
        console.error("프로필 로드 실패:", error);
        setMessage({ type: "error", text: "프로필을 로드할 수 없습니다." });
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  // Save profile changes to Firestore
  const handleSaveProfile = async () => {
    if (!user || !userProfile) return;

    setIsSaving(true);
    try {
      const updatedProfile: UserProfile = {
        ...userProfile,
        displayName,
        bio,
        updatedAt: new Date().toISOString(),
      };
      
      await saveUserProfile(updatedProfile);
      setUserProfile(updatedProfile);
      setIsEditing(false);
      setMessage({ type: "success", text: "프로필이 저장되었습니다! ✓" });
      
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error("프로필 저장 실패:", error);
      setMessage({ type: "error", text: "프로필 저장에 실패했습니다." });
    } finally {
      setIsSaving(false);
    }
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      const auth = getFirebaseAuth();
      if (auth) {
        await firebaseSignOut(auth);
        setUserProfile(null);
        setMessage({ type: "success", text: "로그아웃되었습니다." });
      }
    } catch (error) {
      console.error("로그아웃 실패:", error);
      setMessage({ type: "error", text: "로그아웃에 실패했습니다." });
    }
  };

  // Manual Google Sign-In (fallback when gsi not loaded)
  const handleManualGoogleSignIn = () => {
    const g = (window as any).google;
    if (g?.accounts?.id) {
      g.accounts.id.prompt((notification: any) => {
        if (notification.isDisplayed()) {
          console.log("Google Sign-In prompt displayed");
        }
      });
    } else {
      // Fallback: open Google login in new window
      const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
      const clientId = env.VITE_GOOGLE_CLIENT_ID || env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || "";
      if (!clientId) {
        setMessage({ type: "error", text: "VITE_GOOGLE_CLIENT_ID가 비어 있습니다. .env를 확인하세요." });
        return;
      }
      alert("Google 로그인을 진행해주세요.\n로그인 창이 열리지 않으면 위의 '클라우드 동기화' 섹션의 버튼을 사용하세요.");
      const width = 500;
      const height = 600;
      const left = window.innerWidth / 2 - width / 2;
      const top = window.innerHeight / 2 - height / 2;
      window.open(
        `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(window.location.origin)}&response_type=code&scope=openid%20email%20profile`,
        "Google Sign-In",
        `width=${width},height=${height},left=${left},top=${top}`
      );
    }
  };

  if (!user) {
    return (
      <div className="space-y-6">
        {/* Login Required Card */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 border border-blue-200 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto border-2 border-blue-200">
            <User className="w-8 h-8 text-blue-600" />
          </div>
          
          <div>
            <h3 className="text-lg font-bold text-gray-800">로그인이 필요합니다</h3>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              Google 계정으로 로그인하여 프로필을 관리하고 장소를 클라우드에 저장하세요.
            </p>
          </div>

          {/* Google Sign-In Button */}
          <div className="space-y-3 pt-2">
            <div id="google-signin-btn-settings" className="flex justify-center" style={{ minHeight: '40px' }}></div>
          </div>
        </div>

        {/* Features Info */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
          <h4 className="font-bold text-gray-800 text-sm">로그인의 장점</h4>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <span className="text-gray-700">📍 모든 장소를 클라우드에 저장</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <span className="text-gray-700">🔄 다른 기기에서 자동 동기화</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <span className="text-gray-700">👤 프로필 맞춤 설정</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
              <span className="text-gray-700">🛡️ Google 계정으로 안전하게 관리</span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader className="w-8 h-8 text-[#FF5A5F] animate-spin mb-3" />
        <p className="text-gray-600 text-sm">프로필을 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alert Message */}
      {message && (
        <div className={`p-3 rounded-lg flex items-center gap-2 ${
          message.type === "success" 
            ? "bg-green-50 text-green-700 border border-green-200" 
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {message.type === "success" ? (
            <Check className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}

      {/* User Profile Card */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-5">
        <div className="flex items-start gap-4">
          {user.photoURL ? (
            <img 
              src={user.photoURL} 
              alt="프로필"
              className="w-16 h-16 rounded-full object-cover border-2 border-[#FF5A5F]"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#FF5A5F] to-[#FF8C92] flex items-center justify-center">
              <User className="w-8 h-8 text-white" />
            </div>
          )}
          
          <div className="flex-1">
            {!isEditing ? (
              <>
                <h3 className="text-lg font-bold text-gray-800">{userProfile?.displayName || "사용자"}</h3>
                <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                  <Mail className="w-3.5 h-3.5" />
                  {user.email}
                </p>
                {userProfile?.bio && (
                  <p className="text-sm text-gray-600 mt-2 italic">{userProfile.bio}</p>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="표시 이름"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5A5F]"
                />
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="소개글 (선택사항)"
                  maxLength={150}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5A5F] resize-none"
                  rows={3}
                />
                <p className="text-xs text-gray-400">{bio.length}/150</p>
              </div>
            )}
          </div>
        </div>

        {/* Profile Stats */}
        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">가입일</p>
              <p className="text-sm font-semibold text-gray-800">
                {userProfile?.createdAt ? new Date(userProfile.createdAt).toLocaleDateString('ko-KR') : '-'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">마지막 수정</p>
              <p className="text-sm font-semibold text-gray-800">
                {userProfile?.updatedAt ? new Date(userProfile.updatedAt).toLocaleDateString('ko-KR') : '-'}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="flex-1 py-2.5 px-4 bg-[#FF5A5F] text-white rounded-lg font-semibold text-sm hover:bg-[#FF4A4F] transition-colors"
            >
              프로필 수정
            </button>
          ) : (
            <>
              <button
                onClick={handleSaveProfile}
                disabled={isSaving}
                className="flex-1 py-2.5 px-4 bg-[#FF5A5F] text-white rounded-lg font-semibold text-sm hover:bg-[#FF4A4F] transition-colors disabled:opacity-50"
              >
                {isSaving ? "저장 중..." : "저장"}
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  if (userProfile) {
                    setDisplayName(userProfile.displayName);
                    setBio(userProfile.bio);
                  }
                }}
                className="flex-1 py-2.5 px-4 bg-gray-200 text-gray-800 rounded-lg font-semibold text-sm hover:bg-gray-300 transition-colors"
              >
                취소
              </button>
            </>
          )}
        </div>
      </div>

      {/* Logout Section */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <LogOut className="w-5 h-5 text-gray-400" />
          <h4 className="font-semibold text-gray-800">계정 관리</h4>
        </div>
        <button
          onClick={handleLogout}
          className="w-full py-2.5 px-4 bg-red-50 text-red-600 rounded-lg font-semibold text-sm hover:bg-red-100 transition-colors border border-red-200"
        >
          로그아웃
        </button>
      </div>

      {/* Database Verification Info */}
      <div className="bg-blue-50 rounded-2xl p-4 border border-blue-200 space-y-2">
        <div className="flex items-start gap-2">
          <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-900">데이터베이스 확인</p>
            <p className="text-xs text-blue-700 mt-1">
              ✓ Firestore에 프로필 저장됨<br/>
              ✓ UID: {user.uid.substring(0, 12)}...<br/>
              ✓ 안전하게 저장되어 있습니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
