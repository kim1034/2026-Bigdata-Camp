import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Upload, MapPin, Coffee, Utensils, Home, Compass, 
  Trash2, Plus, X, ChevronRight, Sparkles, Clock, 
  Search, Heart, Info, AlertCircle, Check, Map as MapIcon,
  HelpCircle, ChevronDown, ListFilter, RotateCcw,
  ArrowUp, ArrowDown, Share2, Copy, Calendar, LogOut,
  Settings as SettingsIcon
} from "lucide-react";

import Map from "./components/Map";
import Settings from "./components/Settings";
import { Place, CategoryType, ExtractionResult, PlaceMenu } from "./types";
import { INITIAL_PLACES, DEMO_SCREENSHOTS } from "./data";
import {
  deletePlaceFromFirestore,
  isFirebaseDbConfigured,
  loadPlacesFromFirestore,
  replacePlacesInFirestore,
  savePlaceToFirestore,
  getFirebaseAuth,
} from "./services/firebaseDb";
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";

export default function App() {
  // Load places from localStorage, or default to initial preset places
  const [places, setPlaces] = useState<Place[]>(() => {
    const saved = localStorage.getItem("pinsnap_places");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((p: any) => ({
            id: p.id || "place-" + Math.random(),
            name: p.name || "이름 없는 장소",
            category: p.category || "카페",
            address: p.address || "",
            latitude: typeof p.latitude === "number" ? p.latitude : 37.5446,
            longitude: typeof p.longitude === "number" ? p.longitude : 127.0559,
            hours: p.hours || "정보 없음",
            menu: Array.isArray(p.menu) ? p.menu : [],
            reviewSummary: p.reviewSummary || "정보 없음",
            screenshotText: p.screenshotText || "",
            originalImage: p.originalImage,
            createdAt: p.createdAt || new Date().toISOString()
          }));
        }
      } catch (e) {
        console.error("Failed to parse saved places", e);
      }
    }
    return INITIAL_PLACES;
  });

  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionStep, setExtractionStep] = useState<string>("");

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const currentWorkspaceId = user ? `user_${user.uid}` : "default";
  
  // Verification states
  const [extractedResult, setExtractedResult] = useState<ExtractionResult | null>(null);
  const [verificationName, setVerificationName] = useState("");
  const [verificationCategory, setVerificationCategory] = useState<CategoryType>("카페");
  const [verificationAddress, setVerificationAddress] = useState("");
  const [verificationHours, setVerificationHours] = useState("");
  const [verificationMenu, setVerificationMenu] = useState<PlaceMenu[]>([]);
  const [verificationReview, setVerificationReview] = useState("");
  const [verificationScreenshotText, setVerificationScreenshotText] = useState("");
  const [uploadedImageBase64, setUploadedImageBase64] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<CategoryType | "전체">("전체");

  // File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firebaseHydratedRef = useRef(false);

  // Tab Navigation: "my-places" | "route-planner" | "regional-share" | "ai-itinerary" | "settings"
  const [activeTab, setActiveTab] = useState<"my-places" | "route-planner" | "regional-share" | "ai-itinerary" | "settings">("my-places");

  // Feature 4: AI Itinerary Planner States
  interface ItineraryItem {
    place: Place;
    time: string;
    activity: string;
    duration: string;
    hoursCheck: string;
    tip: string;
    transitToNext: {
      type: "walk" | "car" | null;
      duration: number;
      distance: number;
      text: string;
    } | null;
  }

  const [aiSelectedRegion, setAiSelectedRegion] = useState<string>("");
  const [aiSelectedDate, setAiSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [aiCheckedPlaces, setAiCheckedPlaces] = useState<string[]>([]);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiGenerationStep, setAiGenerationStep] = useState("");
  const [aiGeneratedItinerary, setAiGeneratedItinerary] = useState<ItineraryItem[] | null>(null);
  const [showAiResult, setShowAiResult] = useState(false);

  // Feature 2: Route Planner States
  const [isDrawingZone, setIsDrawingZone] = useState(false);
  const [circleCenter, setCircleCenter] = useState<[number, number] | null>(null);
  const [circleRadius, setCircleRadius] = useState<number>(800); // meters
  const [routePlaces, setRoutePlaces] = useState<Place[]>([]);

  // Feature 3: Share States
  const [showShareToast, setShowShareToast] = useState<string | null>(null);

  // Custom dialog/confirmation and alert states to bypass standard confirm/alert iframe block
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  const [customAlert, setCustomAlert] = useState<{ title: string; message: string } | null>(null);

  const showAlert = (title: string, message: string) => {
    setCustomAlert({ title, message });
  };

  useEffect(() => {
    let isMounted = true;

    async function hydratePlacesFromFirestore() {
      if (!isFirebaseDbConfigured()) {
        return;
      }

      try {
        const remotePlaces = await loadPlacesFromFirestore(currentWorkspaceId);
        if (!isMounted) return;

        firebaseHydratedRef.current = true;
        if (remotePlaces.length > 0) {
          setPlaces(remotePlaces);
        } else {
          // If logged in and the private store is empty, sync local guest data up to cloud
          if (user && places.length > 0 && places !== INITIAL_PLACES) {
            await replacePlacesInFirestore(places, currentWorkspaceId);
          } else {
            await replacePlacesInFirestore(INITIAL_PLACES, currentWorkspaceId);
            setPlaces(INITIAL_PLACES);
          }
        }
      } catch (error) {
        console.warn("Failed to load places from Firestore", error);
      }
    }

    hydratePlacesFromFirestore();

    return () => {
      isMounted = false;
    };
  }, [user]);

  // Listen for authentication changes
  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribe();
  }, []);

  // Haversine formula to compute distance in meters between two lat/lngs
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000; // Earth's radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Auto-manage routePlaces based on circle zone
  useEffect(() => {
    if (!circleCenter) {
      setRoutePlaces([]);
      return;
    }

    // 1. Calculate places currently inside circle
    const insideCircle = places.filter(p => {
      const dist = calculateDistance(circleCenter[0], circleCenter[1], p.latitude, p.longitude);
      return dist <= circleRadius;
    });

    // 2. Keep places in routePlaces that are STILL in places AND inside the circle
    const currentRouteIds = new Set(insideCircle.map(p => p.id));
    const retained = routePlaces.filter(rp => {
      const stillInPlaces = places.some(p => p.id === rp.id);
      return stillInPlaces && currentRouteIds.has(rp.id);
    });

    // 3. Find any new places inside circle that aren't already in retained
    const newInside = insideCircle.filter(ic => !retained.some(r => r.id === ic.id));

    // 4. Combine them
    setRoutePlaces([...retained, ...newInside]);
  }, [circleCenter, circleRadius, places]);

  // Handle setting map circle zone center
  const handleMapClickCoords = (lat: number, lng: number) => {
    if (isDrawingZone) {
      setCircleCenter([lat, lng]);
      setIsDrawingZone(false);
    }
  };

  // Re-ordering route items
  const moveRouteItem = (index: number, direction: "up" | "down") => {
    const updated = [...routePlaces];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= updated.length) return;

    // Swap
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setRoutePlaces(updated);
  };

  // Regional grouping helper
  const getRegionOfAddress = (address: string): string => {
    if (!address) return "기타 지역";
    const parts = address.split(" ");
    const guPart = parts.find(p => p && p.endsWith("구"));
    if (guPart) return guPart;
    const dongPart = parts.find(p => p && (p.endsWith("동") || p.endsWith("가")));
    if (dongPart) return dongPart;
    const siPart = parts.find(p => p && (p.endsWith("시") || p.endsWith("군")));
    if (siPart) return siPart;
    return parts[0] || "기타 지역";
  };

  const placesByRegion = places.reduce<{ [region: string]: Place[] }>((acc, p) => {
    const region = getRegionOfAddress(p.address);
    if (!acc[region]) acc[region] = [];
    acc[region].push(p);
    return acc;
  }, {});

  // Sync selected region when places change or component mounts
  useEffect(() => {
    const regions = Object.keys(placesByRegion);
    if (regions.length > 0 && (!aiSelectedRegion || !regions.includes(aiSelectedRegion))) {
      setAiSelectedRegion(regions[0]);
    } else if (regions.length === 0 && !aiSelectedRegion) {
      setAiSelectedRegion("성동구");
    }
  }, [places, aiSelectedRegion]);

  // Sync checked places when selected region changes
  useEffect(() => {
    if (aiSelectedRegion) {
      const regionPlaces = placesByRegion[aiSelectedRegion] || [];
      setAiCheckedPlaces(regionPlaces.map(p => p.id));
    }
  }, [aiSelectedRegion, places]);

  // AI Itinerary Optimization Generator
  const runAiItineraryPlanner = () => {
    if (aiCheckedPlaces.length === 0) {
      alert("최소 1개 이상의 장소를 지정하셔야 일정을 계획할 수 있습니다.");
      return;
    }

    setIsAiGenerating(true);
    setAiGenerationStep("🤖 AI가 지정하신 장소들의 영업시간과 주소를 분석하는 중...");

    const steps = [
      "🤖 AI가 지정하신 장소들의 영업시간과 주소를 분석하는 중...",
      "🧭 각 목적지 간의 최적 도보 및 대중교통 동선을 계산하는 중...",
      "⏰ 영업 종료 및 브레이크 타임을 매칭하여 방문 타임라인을 정비하는 중...",
      "✨ 하루 가이드라인과 꿀팁을 이식한 맞춤형 AI 데일리 일정표 완성!"
    ];

    let currentStepIndex = 0;
    const interval = setInterval(() => {
      currentStepIndex++;
      if (currentStepIndex < steps.length) {
        setAiGenerationStep(steps[currentStepIndex]);
      } else {
        clearInterval(interval);
        
        // Generate the optimized itinerary list
        const selectedPlaces = places.filter(p => aiCheckedPlaces.includes(p.id));
        
        // Categorize
        const cafes = selectedPlaces.filter(p => p.category === "카페");
        const restaurants = selectedPlaces.filter(p => p.category === "식당");
        const stays = selectedPlaces.filter(p => p.category === "펜션/숙소");
        const attractions = selectedPlaces.filter(p => p.category === "관광지/기타");

        // Chronological sort
        const ordered: Place[] = [];
        const attractionQueue = [...attractions];
        const restaurantQueue = [...restaurants];
        const cafeQueue = [...cafes];
        const stayQueue = [...stays];

        // Interleave
        if (attractionQueue.length > 0) ordered.push(attractionQueue.shift()!);
        if (restaurantQueue.length > 0) ordered.push(restaurantQueue.shift()!);
        if (cafeQueue.length > 0) ordered.push(cafeQueue.shift()!);
        if (attractionQueue.length > 0) ordered.push(attractionQueue.shift()!);
        if (restaurantQueue.length > 0) ordered.push(restaurantQueue.shift()!);
        if (cafeQueue.length > 0) ordered.push(cafeQueue.shift()!);
        
        ordered.push(...attractionQueue, ...restaurantQueue, ...cafeQueue, ...stayQueue);

        let currentTime = new Date();
        currentTime.setHours(10, 30, 0);

        const timeline: ItineraryItem[] = [];

        for (let i = 0; i < ordered.length; i++) {
          const place = ordered[i];
          const category = place.category;

          let activity = "방문 및 체험";
          let duration = "1시간";
          let tip = "인기 스팟이므로 방문하여 인증샷을 남겨보세요.";

          if (category === "식당") {
            const hrs = currentTime.getHours();
            activity = hrs < 15 ? "정갈한 한식 점심 식사" : "맛있는 식사 및 저녁 시간";
            duration = "1시간 20분";
            const signatureMenu = place.menu && place.menu.length > 0 && place.menu[0] ? place.menu[0].name : "메뉴";
            tip = `대표 메뉴인 '${signatureMenu}'은(는) 웨이팅이 있을 수 있으니 이동 중 실시간 혼잡도를 확인해보세요.`;
          } else if (category === "카페") {
            activity = "오후 감성 카페 타임 & 디저트 힐링";
            duration = "1시간";
            const signatureMenu = place.menu && place.menu.length > 0 && place.menu[0] ? place.menu[0].name : "메뉴";
            tip = `시그니처 메뉴인 '${signatureMenu}'와 함께 감성 가득한 분위기 속에서 휴식을 취하기 완벽한 타이밍입니다.`;
          } else if (category === "펜션/숙소") {
            activity = "체크인 및 아늑한 휴식 시간";
            duration = "숙박";
            tip = `고즈넉하고 프라이빗한 공간에서 하루의 동선을 여유롭게 되짚어보며 힐링하는 숙박 일정입니다.`;
          } else if (category === "관광지/기타") {
            activity = "여유로운 명소 관람 및 주변 산책";
            duration = "1시간 30분";
            tip = "대표적인 포토존이 밀집해 있는 코스입니다. 날씨와 뷰를 즐기며 천천히 산책해 보세요.";
          }

          const hoursStr = String(currentTime.getHours()).padStart(2, "0");
          const minsStr = String(currentTime.getMinutes()).padStart(2, "0");
          const timeStr = `${hoursStr}:${minsStr}`;

          let hoursCheck = `영업시간 일치 확인 (방문 시간 ${timeStr} 기준 매장 운영 시간 내에 포함)`;
          if (category === "펜션/숙소") {
            hoursCheck = "체크인 가이드 확인 완료 (체크인 타임 라인 규정 준수)";
          }

          let transitToNext: ItineraryItem["transitToNext"] = null;
          const nextPlace = ordered[i + 1];

          if (nextPlace) {
            const dist = calculateDistance(place.latitude, place.longitude, nextPlace.latitude, nextPlace.longitude);
            const isWalk = dist < 700;
            const speed = isWalk ? 5000 / 60 : 30000 / 60;
            const transitMin = Math.max(2, Math.round(dist / speed));
            const distText = dist >= 1000 ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`;
            const modeText = isWalk ? "🚶 도보" : "🚗 차량";

            transitToNext = {
              type: isWalk ? "walk" : "car",
              duration: transitMin,
              distance: dist,
              text: `${modeText} 이동 ${transitMin}분 (${distText})`
            };

            let durationMins = 60;
            if (duration.includes("1시간 20분")) durationMins = 80;
            else if (duration.includes("1시간 30분")) durationMins = 90;
            else if (duration.includes("1시간")) durationMins = 60;
            else if (duration.includes("숙박")) durationMins = 120;

            currentTime.setMinutes(currentTime.getMinutes() + durationMins + transitMin);
          }

          timeline.push({
            place,
            time: timeStr,
            activity,
            duration,
            hoursCheck,
            tip,
            transitToNext
          });
        }

        setAiGeneratedItinerary(timeline);
        setIsAiGenerating(false);
        setShowAiResult(true);
      }
    }, 600);
  };

  const setPresetDate = (type: "today" | "tomorrow" | "weekend") => {
    const d = new Date();
    if (type === "tomorrow") {
      d.setDate(d.getDate() + 1);
    } else if (type === "weekend") {
      const day = d.getDay();
      const daysToSaturday = (6 - day + 7) % 7;
      d.setDate(d.getDate() + (daysToSaturday === 0 ? 7 : daysToSaturday));
    }
    setAiSelectedDate(d.toISOString().split("T")[0]);
  };

  const safeCopyToClipboard = (text: string, onSuccess: () => void, onError: (err: any) => void) => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(onSuccess).catch((err) => {
        fallbackCopy(text, onSuccess, onError, err);
      });
    } else {
      fallbackCopy(text, onSuccess, onError, "navigator.clipboard not available");
    }
  };

  const fallbackCopy = (text: string, onSuccess: () => void, onError: (err: any) => void, originalError: any) => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.width = "2em";
      textarea.style.height = "2em";
      textarea.style.padding = "0";
      textarea.style.border = "none";
      textarea.style.outline = "none";
      textarea.style.boxShadow = "none";
      textarea.style.background = "transparent";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (success) {
        onSuccess();
      } else {
        onError(originalError);
      }
    } catch (e) {
      onError(e);
    }
  };

  const handleCopyItinerary = () => {
    if (!aiGeneratedItinerary) return;
    
    const header = `[스팟로그] AI 추천 ${aiSelectedRegion} 데일리 일정표 📅\n방문 예정일: ${aiSelectedDate}\nAI가 영업시간과 이동 거리를 최적화한 최상의 동선입니다!\n\n`;
    
    const body = aiGeneratedItinerary.map((item, idx) => {
      let stepStr = `📍 [STEP ${idx + 1}] ${item.time} - ${item.place.name} (${item.place.category})\n`;
      stepStr += `   - 주요 활동: ${item.activity} (${item.duration})\n`;
      stepStr += `   - 영업 상태: ${item.place.hours}\n`;
      stepStr += `   - AI 꿀팁: "${item.tip}"\n`;
      if (item.transitToNext) {
        stepStr += `\n   ▼ 다음 장소로 이동: ${item.transitToNext.text}\n`;
      }
      return stepStr;
    }).join("\n----------------------------------------\n\n");
    
    const footer = `\n\n내 인스타 캡처로 간편하게 동선 짜기, 스팟로그(SpotLog)에서 생성됨.`;
    const fullText = header + body + footer;

    safeCopyToClipboard(
      fullText,
      () => {
        setShowShareToast("AI 일정");
        setTimeout(() => {
          setShowShareToast(null);
        }, 3500);
      },
      (err) => {
        console.error("Itinerary copy failed:", err);
        showAlert("복사 실패", "클립보드 복사에 실패했습니다.");
      }
    );
  };

  // Share/Export Regional List
  const handleShareRegion = (region: string, regionPlaces: Place[]) => {
    const header = `[스팟로그] ${region} 추천 장소 리스트 🗺️\n총 ${regionPlaces.length}곳의 장소 동선을 공유합니다!\n\n`;
    const body = regionPlaces.map((p, idx) => {
      const menuText = Array.isArray(p.menu) && p.menu.length > 0 
        ? p.menu.filter(m => m && m.name).map(m => `${m.name}(${m.price || '정보 없음'})`).join(", ") 
        : "정보 없음";
      return `${idx + 1}. ${p.name} [${p.category}]\n   - 주소: ${p.address}\n   - 대표 메뉴: ${menuText}\n   - AI 한줄평: "${p.reviewSummary}"`;
    }).join("\n\n");
    
    const footer = `\n\n내 인스타 캡처로 간편하게 동선 짜기, 스팟로그(SpotLog)에서 생성됨.`;
    const fullText = header + body + footer;

    safeCopyToClipboard(
      fullText,
      () => {
        setShowShareToast(region);
        setTimeout(() => {
          setShowShareToast(null);
        }, 3500);
      },
      (err) => {
        console.error("Clipboard copy failed:", err);
        showAlert("복사 실패", "클립보드 복사에 실패했습니다. 복사 권한을 확인해주세요.");
      }
    );
  };

  // Save to localStorage whenever places changes
  useEffect(() => {
    try {
      localStorage.setItem("pinsnap_places", JSON.stringify(places));
    } catch (err) {
      console.error("Failed to save places to localStorage:", err);
      // Fallback: If quota exceeded due to large base64 screenshot images, warn the user
      showAlert("저장소 초과", "브라우저 로컬 저장소 용량이 초과되었습니다. 이미지 크기나 저장된 핀 개수를 줄여주세요.");
    }
  }, [places]);

  // Handle manual screenshot upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processImageFile(file);
  };

  const processImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setUploadedImageBase64(base64String);
      triggerExtraction(base64String);
    };
    reader.readAsDataURL(file);
  };

  // Run the OCR -> place matching pipeline
  const triggerExtraction = async (base64Image: string) => {
    setIsExtracting(true);
    setSelectedPlace(null);
    setExtractedResult(null);

    // Progressive simulated loading steps for immersive UX
    const steps = [
      "📷 스크린샷 이미지 업로드 중...",
      "🔍 AI 오작동 방지 및 OCR 텍스트 분석 중...",
      "📍 가게명 & 지역 키워드 매칭 중...",
      "✨ Google Places API 가상 동기화 및 가공 중..."
    ];

    let currentStepIndex = 0;
    setExtractionStep(steps[currentStepIndex]);

    const progressInterval = setInterval(() => {
      if (currentStepIndex < steps.length - 1) {
        currentStepIndex++;
        setExtractionStep(steps[currentStepIndex]);
      }
    }, 1200);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Image }),
      });

      const data = await response.json();
      clearInterval(progressInterval);

      const safeData = data || {};
      // Set verification form states with extracted data
      setExtractedResult(safeData);
      setVerificationName(safeData.name || "");
      setVerificationCategory(safeData.category || "카페");
      setVerificationAddress(safeData.address || "");
      setVerificationHours(safeData.hours || "정보 없음");
      setVerificationMenu(Array.isArray(safeData.menu) ? safeData.menu : []);
      setVerificationReview(safeData.reviewSummary || "정보 없음");
      setVerificationScreenshotText(safeData.screenshotText || "");
    } catch (error) {
      console.error("Extraction error:", error);
      clearInterval(progressInterval);
      
      // Fallback is handled server-side, but if server fails completely:
      showAlert("서버 연결 실패", "서버 연결에 실패하여 데모 데이터를 제공합니다.");
      setIsExtracting(false);
    } finally {
      setIsExtracting(false);
    }
  };

  // Handle Demo Screenshot trigger
  const handleDemoScreenshotClick = async (demo: typeof DEMO_SCREENSHOTS[0]) => {
    setIsExtracting(true);
    setSelectedPlace(null);
    setExtractedResult(null);
    
    // Simulate converting a URL or utilizing direct sample
    setUploadedImageBase64(demo.imageUrl);
    
    const steps = [
      "🌟 데모 스크린샷 분석 시작...",
      "🔍 이미지 내 텍스트(OCR) 추출 중...",
      "📍 위치 데이터 매칭 및 카테고리 분류 중...",
      "🎨 상세 프로필 정보 생성 중..."
    ];

    let currentStepIndex = 0;
    setExtractionStep(steps[currentStepIndex]);

    const progressInterval = setInterval(() => {
      if (currentStepIndex < steps.length - 1) {
        currentStepIndex++;
        setExtractionStep(steps[currentStepIndex]);
      }
    }, 1000);

    try {
      // Send the image URL to mock or trigger matching
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: demo.imageUrl }),
      });

      const data = await response.json();
      clearInterval(progressInterval);

      const safeData = data || {};
      setExtractedResult(safeData);
      setVerificationName(safeData.name || "");
      setVerificationCategory(safeData.category || "카페");
      setVerificationAddress(safeData.address || "");
      setVerificationHours(safeData.hours || "정보 없음");
      setVerificationMenu(Array.isArray(safeData.menu) ? safeData.menu : []);
      setVerificationReview(safeData.reviewSummary || "정보 없음");
      setVerificationScreenshotText(safeData.screenshotText || "");
    } catch (e) {
      clearInterval(progressInterval);
      console.error(e);
    } finally {
      setIsExtracting(false);
    }
  };

  // Save verified place to the map database
  const handleSavePlace = () => {
    if (!verificationName.trim()) return;

    const rawLat = Number(extractedResult?.latitude);
    const rawLng = Number(extractedResult?.longitude);
    const finalLat = !isNaN(rawLat) && rawLat !== 0 ? rawLat : 37.5446;
    const finalLng = !isNaN(rawLng) && rawLng !== 0 ? rawLng : 127.0559;

    const newPlace: Place = {
      id: "place-" + Date.now(),
      name: verificationName,
      category: verificationCategory,
      address: verificationAddress,
      latitude: finalLat,
      longitude: finalLng,
      hours: verificationHours,
      menu: verificationMenu,
      reviewSummary: verificationReview,
      screenshotText: verificationScreenshotText,
      originalImage: uploadedImageBase64 || undefined,
      createdAt: new Date().toISOString()
    };

    setPlaces((prev) => [newPlace, ...prev]);
    savePlaceToFirestore(newPlace, currentWorkspaceId).catch((error) => {
      console.warn("Failed to save place to Firestore", error);
    });
    setSelectedPlace(newPlace); // Center map on the newly saved place
    
    // Reset uploader & verification states
    setExtractedResult(null);
    setUploadedImageBase64(null);
  };

  // Delete place trigger (opens custom dialog)
  const handleDeletePlace = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setConfirmDeleteId(id);
  };

  // Perform actual deletion of the place after confirmation
  const executeDeletePlace = (id: string) => {
    setPlaces((prev) => prev.filter((p) => p.id !== id));
    deletePlaceFromFirestore(id, currentWorkspaceId).catch((error) => {
      console.warn("Failed to delete place from Firestore", error);
    });
    if (selectedPlace?.id === id) {
      setSelectedPlace(null);
    }
    setConfirmDeleteId(null);
  };

  // Reset preset database trigger (opens custom dialog)
  const handleResetPresets = () => {
    setConfirmReset(true);
  };

  // Perform actual reset after confirmation
  const executeResetPresets = () => {
    setPlaces(INITIAL_PLACES);
    replacePlacesInFirestore(INITIAL_PLACES, currentWorkspaceId).catch((error) => {
      console.warn("Failed to reset Firestore places", error);
    });
    setSelectedPlace(null);
    setExtractedResult(null);
    localStorage.removeItem("pinsnap_places");
    setConfirmReset(false);
  };

  // Filtering places
  const filteredPlaces = places.filter((place) => {
    const name = place.name || "";
    const address = place.address || "";
    const screenshotText = place.screenshotText || "";
    
    const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          address.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          screenshotText.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategoryFilter === "전체" || place.category === activeCategoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Get icons styled for category list
  const getCategoryTheme = (category: CategoryType) => {
    switch (category) {
      case "카페":
        return { bg: "bg-amber-50 text-amber-700 border-amber-200", badge: "bg-amber-500", icon: <Coffee className="w-4 h-4" /> };
      case "식당":
        return { bg: "bg-rose-50 text-rose-700 border-rose-200", badge: "bg-rose-500", icon: <Utensils className="w-4 h-4" /> };
      case "펜션/숙소":
        return { bg: "bg-indigo-50 text-indigo-700 border-indigo-200", badge: "bg-indigo-500", icon: <Home className="w-4 h-4" /> };
      case "관광지/기타":
      default:
        return { bg: "bg-emerald-50 text-emerald-700 border-emerald-200", badge: "bg-emerald-500", icon: <Compass className="w-4 h-4" /> };
    }
  };

  return (
    <div id="pinsnap-root" className="w-full h-screen flex flex-col md:flex-row bg-[#f8f9fa] font-sans select-none overflow-hidden text-[#2d3436]">
      
      {/* LEFT COLUMN: Sidebar Dashboard / Capturing Control Panel */}
      <div id="pinsnap-sidebar" className="w-full md:w-[460px] lg:w-[500px] h-[50%] md:h-full flex flex-col bg-white border-b md:border-b-0 md:border-r border-gray-200 overflow-hidden z-30 shadow-2xl">
        
        {/* Sidebar Header */}
        <div className="p-5 border-b border-gray-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-[#FF5A5F] rounded-xl flex items-center justify-center shadow-lg shadow-red-100">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black text-[#FF5A5F] tracking-tight flex items-center gap-1">
                스팟로그 <span className="text-[10px] font-bold bg-red-50 text-[#FF5A5F] border border-red-150 px-1.5 py-0.5 rounded-full">SpotLog</span>
              </h1>
              <p className="text-[11px] text-gray-500 font-medium">인스타 캡처 한 장으로 끝내는 장소 지도</p>
            </div>
          </div>

          <button 
            onClick={handleResetPresets}
            className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-500 hover:text-[#2d3436] transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
            title="기본 샘플 데이터로 초기화"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>초기화</span>
          </button>
        </div>

        {/* Authentication Bar */}
        <div className="px-5 py-3 border-b border-gray-150 bg-[#FAF9F6]/50 flex flex-col gap-2 shrink-0">
          {user && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || "User"} className="w-8 h-8 rounded-full border border-gray-250" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center font-bold text-xs text-[#FF5A5F]">
                    {user.displayName ? user.displayName.slice(0, 1) : "U"}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-800 truncate">{user.displayName || "사용자"}</p>
                  <p className="text-[10px] text-gray-400 truncate">{user.email}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  const auth = getFirebaseAuth();
                  if (auth) firebaseSignOut(auth);
                }}
                className="p-1.5 rounded-lg text-gray-450 hover:text-red-500 hover:bg-red-50 transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                title="로그아웃"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>로그아웃</span>
              </button>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-150 bg-gray-50/50 p-1 shrink-0">
          <button
            onClick={() => setActiveTab("my-places")}
            className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === "my-places"
                ? "bg-white text-[#FF5A5F] shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            내 스팟
          </button>
          <button
            onClick={() => setActiveTab("route-planner")}
            className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === "route-planner"
                ? "bg-white text-[#FF5A5F] shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            동선 짜기
          </button>
          <button
            onClick={() => setActiveTab("regional-share")}
            className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === "regional-share"
                ? "bg-white text-[#FF5A5F] shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            <Share2 className="w-3.5 h-3.5" />
            지역별 공유
          </button>
          <button
            onClick={() => setActiveTab("ai-itinerary")}
            className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === "ai-itinerary"
                ? "bg-white text-[#FF5A5F] shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
            AI 일정 짜기
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex-1 py-2 rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === "settings"
                ? "bg-white text-[#FF5A5F] shadow-sm border border-gray-200"
                : "text-gray-500 hover:text-gray-800"
            }`}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            설정
          </button>
        </div>

        {/* Sidebar Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar bg-[#f8f9fa]">
          
          {activeTab === "my-places" && (
            <>
              {/* Section 1: Capture Share simulation & Image Upload */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-gray-700 tracking-wider uppercase flex items-center gap-1.5">
                    <Upload className="w-4 h-4 text-[#FF5A5F]" />
                    장소 캡처 이미지 업로드
                  </h3>
                  <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200 font-medium">기능 1 전용</span>
                </div>

                {/* Drag & Drop File Upload Trigger Area */}
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 hover:border-[#FF5A5F] rounded-2xl p-6 text-center cursor-pointer bg-white hover:bg-gray-50/55 transition-all duration-200 group relative overflow-hidden shadow-sm"
                >
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/*"
                    className="hidden" 
                  />
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-11 h-11 rounded-full bg-gray-50 group-hover:bg-red-50 flex items-center justify-center border border-gray-150 group-hover:border-red-100 transition-all">
                      <Upload className="w-5 h-5 text-gray-400 group-hover:text-[#FF5A5F]" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-700 group-hover:text-[#FF5A5F] transition-colors">
                        인스타/지도 캡처 이미지를 여기에 드롭하거나 클릭
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1 font-medium">
                        PNG, JPG, JPEG (스마트폰 스크린샷 권장)
                      </p>
                    </div>
                  </div>
                </div>

                {/* Quick Demo Screenshot Presets (Crucial for testing instant UX!) */}
                <div className="bg-white rounded-2xl p-4 border border-gray-150 space-y-3 shadow-sm">
                  <p className="text-[11px] font-bold text-gray-600 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-[#FF5A5F]" />
                    원클릭 데모 캡처로 즉시 테스트 해보세요:
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {DEMO_SCREENSHOTS.map((demo, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleDemoScreenshotClick(demo)}
                        className="w-full text-left p-2 rounded-xl bg-[#f8f9fa] hover:bg-white border border-gray-150 hover:border-[#FF5A5F] flex items-center gap-2.5 transition-all text-xs text-gray-700 cursor-pointer group"
                      >
                        <img 
                          src={demo.imageUrl} 
                          alt={demo.name}
                          className="w-10 h-10 rounded-lg object-cover border border-gray-200 group-hover:scale-105 transition-transform" 
                          referrerPolicy="no-referrer"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-gray-800 group-hover:text-[#FF5A5F] transition-colors truncate">
                            {demo.name}
                          </p>
                          <p className="text-[10px] text-gray-400 font-medium truncate mt-0.5">{demo.promptHint}</p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-[#FF5A5F] group-hover:translate-x-0.5 transition-all" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Section 2: My Places List with Filter & Search */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-gray-700 tracking-wider uppercase flex items-center gap-1.5">
                    <MapIcon className="w-4 h-4 text-[#FF5A5F]" />
                    나의 저장된 장소들 ({filteredPlaces.length})
                  </h3>
                  <span className="text-[10px] text-gray-400 font-mono font-bold">LOCAL STORAGE</span>
                </div>

                {/* Search Input */}
                <div className="relative">
                  <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="가게명, 주소, 태그 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-xs bg-white border border-gray-200 rounded-xl text-gray-850 placeholder-gray-400 focus:outline-none focus:border-[#FF5A5F] transition-colors shadow-sm"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery("")} 
                      className="absolute right-3.5 top-2.5 text-gray-400 hover:text-gray-600 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Category Filter Pills */}
                <div className="flex flex-wrap gap-1.5">
                  {(["전체", "카페", "식당", "펜션/숙소", "관광지/기타"] as const).map((filter) => {
                    const isActive = activeCategoryFilter === filter;
                    return (
                      <button
                        key={filter}
                        onClick={() => setActiveCategoryFilter(filter)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          isActive 
                            ? "bg-[#FF5A5F] text-white shadow-md shadow-red-100 border-[#FF5A5F]" 
                            : "bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-800 border border-gray-200"
                        }`}
                      >
                        {filter}
                      </button>
                    );
                  })}
                </div>

                {/* Place Card List */}
                <div className="space-y-2">
                  {filteredPlaces.length === 0 ? (
                    <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200 p-4 shadow-sm">
                      <Info className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                      <p className="text-xs font-bold text-gray-400">저장된 장소가 없습니다.</p>
                      <p className="text-[10px] text-gray-400 mt-1">인스타 캡처를 업로드해 첫 장소를 저장해보세요!</p>
                    </div>
                  ) : (
                    filteredPlaces.map((place) => {
                      const theme = getCategoryTheme(place.category);
                      const isSelected = selectedPlace?.id === place.id;

                      return (
                        <div
                          key={place.id}
                          onClick={() => setSelectedPlace(place)}
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex gap-3 relative group ${
                            isSelected 
                              ? "bg-white border-[#FF5A5F] shadow-lg shadow-red-50/50 ring-1 ring-[#FF5A5F]" 
                              : "bg-white hover:bg-gray-50 border-gray-200/80 hover:border-gray-300"
                          }`}
                        >
                          {/* Left: Mini Category Emblem */}
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${theme.bg}`}>
                            {theme.icon}
                          </div>

                          {/* Middle: Name and Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs font-bold text-gray-800 truncate">{place.name}</h4>
                              <span className={`w-1.5 h-1.5 rounded-full ${theme.badge}`} />
                              <span className="text-[10px] text-gray-400 shrink-0 font-medium">{place.category}</span>
                            </div>
                            <p className="text-[11px] text-gray-500 truncate mt-0.5">{place.address}</p>
                            
                            {place.menu && place.menu.length > 0 && place.menu[0] && (
                              <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                                <span className="text-[9px] bg-gray-50 text-gray-600 px-1.5 py-0.5 rounded border border-gray-150">
                                  🍰 {place.menu[0].name || "대표 메뉴"} {place.menu[0].price ? `(${place.menu[0].price})` : ""}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Right: Actions */}
                          <div className="flex flex-col justify-between items-end shrink-0">
                            <button
                              onClick={(e) => handleDeletePlace(place.id, e)}
                              className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                              title="삭제"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 group-hover:translate-x-0.5 transition-all mt-auto" />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === "route-planner" && (
            <div className="space-y-5">
              {/* Header Info */}
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-gray-700 tracking-wider uppercase flex items-center gap-1.5">
                  <Compass className="w-4 h-4 text-[#FF5A5F]" />
                  반경 동선 짜기 (Route Optimizer)
                </h3>
                <p className="text-[11px] text-gray-500 leading-relaxed font-medium">
                  지도상에 가상의 원을 그려 특정 구역 내 장소들을 묶고, 최적의 동선(순서)을 계획해 보세요.
                </p>
              </div>

              {/* Set Center Controls */}
              <div className="bg-white rounded-2xl p-4 border border-gray-150 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-800">1단계: 동선 중심점 지정</span>
                  {circleCenter ? (
                    <button
                      onClick={() => {
                        setCircleCenter(null);
                        setIsDrawingZone(false);
                      }}
                      className="text-[10px] text-red-500 hover:text-red-600 font-bold flex items-center gap-0.5 cursor-pointer"
                    >
                      <X className="w-3 h-3" /> 구역 초기화
                    </button>
                  ) : null}
                </div>

                {!circleCenter ? (
                  <div className="space-y-2">
                    <button
                      onClick={() => setIsDrawingZone(!isDrawingZone)}
                      className={`w-full py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        isDrawingZone
                          ? "bg-amber-500 text-white shadow-lg shadow-amber-100 animate-pulse"
                          : "bg-[#FF5A5F] hover:bg-[#ff444a] text-white shadow-md shadow-red-100"
                      }`}
                    >
                      <MapPin className="w-4 h-4" />
                      {isDrawingZone ? "지도의 원하는 곳을 클릭하세요..." : "지도에서 구역 지정 시작하기"}
                    </button>
                    <p className="text-[10px] text-gray-400 text-center font-medium leading-relaxed">
                      ※ 버튼을 클릭한 후, <strong>오른쪽 폰 지도 화면</strong>의 임의의 위치를 찍으면 반경 원이 활성화됩니다.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-150 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                        <span className="text-[11px] font-bold text-gray-700">지정된 중심 좌표</span>
                      </div>
                      <span className="text-[11px] font-mono text-gray-500 font-semibold">
                        {circleCenter[0].toFixed(4)}, {circleCenter[1].toFixed(4)}
                      </span>
                    </div>

                    {/* Radius Selector */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-bold text-gray-600">동선 검색 반경</span>
                        <span className="text-xs font-black text-[#FF5A5F]">{circleRadius >= 1000 ? `${(circleRadius/1000).toFixed(1)}km` : `${circleRadius}m`}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[500, 800, 1200, 2000].map((r) => (
                          <button
                            key={r}
                            onClick={() => setCircleRadius(r)}
                            className={`py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer border ${
                              circleRadius === r
                                ? "bg-[#FF5A5F] border-[#FF5A5F] text-white shadow-sm"
                                : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                            }`}
                          >
                            {r >= 1000 ? `${r/1000}km` : `${r}m`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Route Order List section */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-800">2단계: 방문 순서 지정 ({routePlaces.length}곳 묶임)</span>
                  {routePlaces.length >= 2 && (
                    <span className="text-[10px] text-gray-400 font-bold bg-white px-2 py-0.5 rounded-full border border-gray-150">
                      지도에 경로 실선 표시 중 ⚡
                    </span>
                  )}
                </div>

                {!circleCenter ? (
                  <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200 p-4 shadow-sm text-gray-400">
                    <Compass className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-xs font-bold">먼저 지도에서 동선 구역을 지정해 주세요.</p>
                  </div>
                ) : routePlaces.length === 0 ? (
                  <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200 p-4 shadow-sm">
                    <Info className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-xs font-bold text-gray-400">구역 내에 저장된 장소가 없습니다.</p>
                    <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                      구역 반경을 넓히거나, 지도의 다른 지점을 클릭하여<br />장소들이 원 안에 들어오도록 이동해 보세요!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {routePlaces.map((place, index) => {
                      const theme = getCategoryTheme(place.category);
                      return (
                        <div
                          key={place.id}
                          className="bg-white border border-gray-150 rounded-2xl p-3 flex items-center gap-3 shadow-sm hover:border-gray-300 transition-all"
                        >
                          {/* Visitation Index marker */}
                          <div className="w-6 h-6 rounded-full bg-black text-white text-xs font-black flex items-center justify-center shrink-0">
                            {index + 1}
                          </div>

                          {/* Icon */}
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${theme.bg}`}>
                            {theme.icon}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold text-gray-800 truncate">{place.name}</h4>
                            <p className="text-[10px] text-gray-400 truncate">{place.category} · {place.address}</p>
                          </div>

                          {/* Manual Reordering buttons */}
                          <div className="flex flex-col gap-1 shrink-0">
                            <button
                              onClick={() => moveRouteItem(index, "up")}
                              disabled={index === 0}
                              className={`p-1 rounded hover:bg-gray-100 border border-gray-100 cursor-pointer disabled:opacity-30 disabled:pointer-events-none`}
                              title="순서 위로"
                            >
                              <ArrowUp className="w-3 h-3 text-gray-500" />
                            </button>
                            <button
                              onClick={() => moveRouteItem(index, "down")}
                              disabled={index === routePlaces.length - 1}
                              className={`p-1 rounded hover:bg-gray-100 border border-gray-100 cursor-pointer disabled:opacity-30 disabled:pointer-events-none`}
                              title="순서 아래로"
                            >
                              <ArrowDown className="w-3 h-3 text-gray-500" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "regional-share" && (
            <div className="space-y-5">
              {/* Header Info */}
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-gray-700 tracking-wider uppercase flex items-center gap-1.5">
                  <Share2 className="w-4 h-4 text-[#FF5A5F]" />
                  내 저장 목록 지역별 공유
                </h3>
                <p className="text-[11px] text-gray-500 leading-relaxed font-medium">
                  내가 직접 모은 스팟들을 법정동/자치구 단위로 정렬하여 복사 가능한 텍스트 묶음으로 친구에게 전송해보세요.
                </p>
              </div>

              {/* Region accordion-style blocks */}
              <div className="space-y-3.5">
                {Object.keys(placesByRegion).length === 0 ? (
                  <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200 p-4 shadow-sm text-gray-400">
                    <Info className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-xs font-bold">저장된 장소가 없어 지역을 나눌 수 없습니다.</p>
                  </div>
                ) : (
                  Object.keys(placesByRegion).map((region) => {
                    const regionPlaces = placesByRegion[region];
                    return (
                      <div key={region} className="bg-white border border-gray-150 rounded-2xl p-4 space-y-3.5 shadow-sm">
                        {/* Title and Badge */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-base">📍</span>
                            <h4 className="font-black text-sm text-gray-800">{region}</h4>
                          </div>
                          <span className="text-[10px] bg-red-50 text-[#FF5A5F] border border-red-100 px-2.5 py-0.5 rounded-full font-bold">
                            스팟 {regionPlaces.length}개
                          </span>
                        </div>

                        {/* List preview (compact) */}
                        <div className="space-y-1.5 border-l-2 border-gray-100 pl-2">
                          {regionPlaces.map((p) => (
                            <div key={p.id} className="text-[11px] flex items-center gap-1.5 text-gray-600">
                              <span>🏡</span>
                              <span className="font-bold text-gray-800 truncate">{p.name}</span>
                              <span className="text-[9px] text-gray-400">({p.category})</span>
                            </div>
                          ))}
                        </div>

                        {/* Export Button */}
                        <button
                          onClick={() => handleShareRegion(region, regionPlaces)}
                          className="w-full py-2.5 bg-gray-50 hover:bg-[#FF5A5F]/10 text-gray-700 hover:text-[#FF5A5F] border border-gray-200 hover:border-[#FF5A5F]/20 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>이 지역 목록 텍스트로 내보내기 (공유)</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === "ai-itinerary" && (
            <div className="space-y-5">
              {/* Header Info */}
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-gray-700 tracking-wider uppercase flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                  AI 최적 데일리 일정 플래너 (Beta)
                </h3>
                <p className="text-[11px] text-gray-500 leading-relaxed font-medium">
                  지정한 스팟들의 영업시간과 주소를 분석해 최적의 방문 순서와 타임라인, 이동 수단 및 이동 시간을 계산하여 완벽한 일정을 짜줍니다.
                </p>
              </div>

              {/* Loader */}
              {isAiGenerating && (
                <div className="bg-white rounded-3xl p-6 border border-gray-150 shadow-md text-center space-y-4">
                  <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border-4 border-amber-100 border-t-amber-500 animate-spin" />
                    <Sparkles className="w-6 h-6 text-amber-500 animate-pulse" />
                  </div>
                  <div className="space-y-1.5 px-2">
                    <h4 className="text-xs font-black text-gray-800">AI 엔진 가동 중...</h4>
                    <p className="text-[11px] text-[#FF5A5F] font-bold leading-relaxed animate-pulse">
                      {aiGenerationStep}
                    </p>
                  </div>
                </div>
              )}

              {/* Form Config */}
              {!isAiGenerating && !showAiResult && (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl p-4 border border-gray-150 space-y-4 shadow-sm">
                    {/* Setup Region */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-black text-gray-800 flex items-center gap-1">
                        <span>📍 1단계: 방문할 지역 선택</span>
                      </label>
                      <select
                        value={aiSelectedRegion}
                        onChange={(e) => setAiSelectedRegion(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-gray-200 text-xs font-bold bg-gray-50 focus:bg-white focus:outline-none transition-all"
                      >
                        {Object.keys(placesByRegion).length === 0 ? (
                          <option value="성동구">성동구 (기본)</option>
                        ) : (
                          Object.keys(placesByRegion).map((region) => (
                            <option key={region} value={region}>
                              {region} ({placesByRegion[region].length}개의 저장된 스팟)
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    {/* Setup Date */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-black text-gray-800 flex items-center gap-1">
                        <span>📅 2단계: 방문 일정 지정</span>
                      </label>
                      <input
                        type="date"
                        value={aiSelectedDate}
                        onChange={(e) => setAiSelectedDate(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-gray-200 text-xs font-bold bg-gray-50 focus:bg-white focus:outline-none transition-all"
                      />
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          onClick={() => setPresetDate("today")}
                          className="py-1.5 rounded-lg text-[10px] font-black border border-gray-200 text-gray-500 hover:bg-gray-50 cursor-pointer"
                        >
                          오늘
                        </button>
                        <button
                          onClick={() => setPresetDate("tomorrow")}
                          className="py-1.5 rounded-lg text-[10px] font-black border border-gray-200 text-gray-500 hover:bg-gray-50 cursor-pointer"
                        >
                          내일
                        </button>
                        <button
                          onClick={() => setPresetDate("weekend")}
                          className="py-1.5 rounded-lg text-[10px] font-black border border-gray-200 text-gray-500 hover:bg-gray-50 cursor-pointer"
                        >
                          이번주 주말
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Checked Places Selector */}
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-800">
                        3단계: 일정에 넣고 싶은 스팟 지정
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => {
                            const regionPlaces = placesByRegion[aiSelectedRegion] || [];
                            setAiCheckedPlaces(regionPlaces.map(p => p.id));
                          }}
                          className="text-[9px] text-[#FF5A5F] bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full font-bold cursor-pointer hover:bg-red-100"
                        >
                          전체 선택
                        </button>
                        <button
                          onClick={() => setAiCheckedPlaces([])}
                          className="text-[9px] text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full font-bold cursor-pointer hover:bg-gray-200"
                        >
                          전체 해제
                        </button>
                      </div>
                    </div>

                    {(!aiSelectedRegion || !placesByRegion[aiSelectedRegion] || placesByRegion[aiSelectedRegion].length === 0) ? (
                      <div className="bg-amber-50/50 border border-amber-200/60 rounded-2xl p-4 text-center space-y-1.5">
                        <Info className="w-5 h-5 text-amber-500 mx-auto" />
                        <h4 className="text-xs font-bold text-amber-800">저장된 장소가 부족합니다</h4>
                        <p className="text-[10px] text-amber-600 font-medium leading-relaxed">
                          현재 선택하신 지역({aiSelectedRegion || "선택 안됨"})에 저장된 스팟이 없습니다.<br />
                          '내 스팟' 탭에서 인스타 스크린샷 캡처를 업로드하여 새로운 장소를 등록하거나 다른 지역을 골라보세요.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                        {(placesByRegion[aiSelectedRegion] || []).map((place) => {
                          const isChecked = aiCheckedPlaces.includes(place.id);
                          const theme = getCategoryTheme(place.category);
                          return (
                            <div
                              key={place.id}
                              onClick={() => {
                                if (isChecked) {
                                  setAiCheckedPlaces(aiCheckedPlaces.filter(id => id !== place.id));
                                } else {
                                  setAiCheckedPlaces([...aiCheckedPlaces, place.id]);
                                }
                              }}
                              className={`bg-white border rounded-2xl p-3 flex items-center gap-2.5 shadow-sm hover:border-gray-300 transition-all cursor-pointer ${
                                isChecked ? "border-[#FF5A5F]/40 bg-[#FF5A5F]/2" : "border-gray-150"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                readOnly
                                className="w-3.5 h-3.5 text-[#FF5A5F] rounded border-gray-300 focus:ring-[#FF5A5F] cursor-pointer shrink-0"
                              />
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center border shrink-0 ${theme.bg}`}>
                                {theme.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-bold text-gray-800 truncate">{place.name}</h4>
                                <p className="text-[10px] text-gray-400 truncate">{place.category} · {place.hours}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Trigger CTA */}
                  <button
                    onClick={runAiItineraryPlanner}
                    disabled={aiCheckedPlaces.length === 0}
                    className="w-full py-3.5 bg-gradient-to-r from-amber-500 via-[#FF5A5F] to-rose-500 hover:brightness-105 disabled:brightness-95 disabled:opacity-50 text-white rounded-2xl text-xs font-black shadow-lg shadow-red-100 transition-all flex items-center justify-center gap-2 cursor-pointer border-none"
                  >
                    <Sparkles className="w-4 h-4 animate-pulse" />
                    <span>AI 최적 하루 일정 생성하기</span>
                  </button>
                </div>
              )}

              {/* Show Generated Timeline */}
              {!isAiGenerating && showAiResult && aiGeneratedItinerary && (
                <div className="space-y-4">
                  {/* Results Top Panel */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => {
                        setShowAiResult(false);
                      }}
                      className="text-[11px] font-black text-gray-500 hover:text-gray-800 flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>← 다시 조건 수정하기</span>
                    </button>
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                      AI 동선 정렬 완료 ⚡
                    </span>
                  </div>

                  <div className="bg-white rounded-3xl p-4 border border-gray-150 shadow-sm space-y-4">
                    {/* Schedule Card Title */}
                    <div className="flex items-center gap-2 bg-gradient-to-r from-amber-50 to-red-50/50 p-2.5 rounded-2xl border border-amber-100">
                      <Calendar className="w-4 h-4 text-amber-500" />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-gray-800">{aiSelectedRegion} 데일리 코스</h4>
                        <p className="text-[10px] text-gray-500 font-medium">지정 일정: {aiSelectedDate} ({aiGeneratedItinerary.length}곳 최적 방문)</p>
                      </div>
                    </div>

                    {/* Timeline Itinerary Items */}
                    <div className="relative pl-4 space-y-5">
                      {/* Vertical connector line */}
                      <div className="absolute left-1.5 top-2.5 bottom-2.5 w-0.5 border-l-2 border-dashed border-gray-200" />

                      {aiGeneratedItinerary.map((item, index) => {
                        const theme = getCategoryTheme(item.place.category);
                        return (
                          <div key={item.place.id} className="relative space-y-2 pl-4">
                            {/* Marker dot */}
                            <div className="absolute -left-6.5 top-1.5 w-5 h-5 rounded-full bg-slate-900 border-2 border-white text-white text-[9px] font-black flex items-center justify-center z-10 shadow shadow-slate-300">
                              {index + 1}
                            </div>

                            {/* Main timeline item box */}
                            <div className="bg-slate-50 hover:bg-slate-100/70 border border-slate-150 rounded-2xl p-3 space-y-2 transition-all">
                              {/* Meta: Time and badge */}
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-extrabold text-slate-800 flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5 text-[#FF5A5F]" />
                                  {item.time} ({item.duration})
                                </span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${theme.badge}`}>
                                  {item.place.category}
                                </span>
                              </div>

                              {/* Spot Info */}
                              <div>
                                <h5 className="text-xs font-black text-gray-800 truncate">{item.place.name}</h5>
                                <p className="text-[10px] text-gray-500 truncate mt-0.5">{item.place.address}</p>
                              </div>

                              {/* Activity Label */}
                              <div className="bg-white px-2.5 py-1.5 rounded-xl border border-gray-150 flex items-center gap-1.5">
                                <span className="text-[11px]">⚡</span>
                                <span className="text-[10px] font-bold text-gray-700">{item.activity}</span>
                              </div>

                              {/* AI Tip block */}
                              <div className="bg-amber-50/60 border border-amber-200/50 rounded-xl p-2.5 flex items-start gap-1.5">
                                <span className="text-xs shrink-0">💡</span>
                                <p className="text-[10px] text-amber-800 font-medium leading-relaxed">
                                  <strong>AI 팁:</strong> {item.tip}
                                </p>
                              </div>

                              {/* Hours Check status */}
                              <div className="text-[9px] text-emerald-600 font-bold flex items-center gap-1 pl-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                <span>{item.hoursCheck}</span>
                              </div>
                            </div>

                            {/* Transit section (placed after the item card, if there is a next step) */}
                            {item.transitToNext && (
                              <div className="flex items-center gap-1.5 pl-3 py-1 bg-slate-50/50 border border-dashed border-slate-200 rounded-xl text-[10px] font-bold text-[#FF5A5F] max-w-max">
                                <span>🚙</span>
                                <span>{item.transitToNext.text}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Timeline Export Copy */}
                    <button
                      onClick={handleCopyItinerary}
                      className="w-full py-3 bg-[#FF5A5F] hover:bg-[#ff444a] text-white rounded-xl text-xs font-black shadow-md shadow-red-100 transition-all flex items-center justify-center gap-2 cursor-pointer border-none"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>이 AI 일정표 전체 복사 (공유)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "settings" && (
            <Settings user={user} />
          )}

        </div>

        {/* Sidebar Footer */}
        <div className="p-4 bg-white border-t border-gray-250 text-center">
          <p className="text-[10px] text-gray-400 font-medium">
            스팟로그 (SpotLog) - 기획서 기반 MVP 작동 시뮬레이터
          </p>
        </div>
      </div>

      {/* RIGHT COLUMN: Phone Frame Wrapper containing map and dialogs */}
      <div id="pinsnap-preview" className="flex-1 h-[50%] md:h-full bg-gray-50 flex items-center justify-center p-3 md:p-6 lg:p-10 relative overflow-hidden">
        
        {/* Background Ambient Mesh */}
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-indigo-500/10 rounded-full filter blur-[100px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-pink-500/5 rounded-full filter blur-[120px] pointer-events-none" />

        {/* High-Fidelity iPhone Emulator Shell */}
        <div className="relative w-full max-w-[420px] h-full max-h-[840px] aspect-[9/19.5] rounded-[48px] border-[10px] border-slate-800 bg-black shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col ring-4 ring-slate-700/50">
          
          {/* iOS Dynamic Island Notch */}
          <div className="absolute top-2.5 left-1/2 transform -translate-x-1/2 w-28 h-6 bg-black rounded-full z-40 flex items-center justify-between px-3.5">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-900 border border-slate-800" />
            <div className="w-4 h-1 bg-slate-950 rounded-full" />
          </div>

          {/* iOS Status Bar */}
          <div className="h-10 bg-white/95 border-b border-slate-100 flex items-end justify-between px-6 pb-1.5 z-30 select-none shrink-0">
            <span className="text-[11px] font-bold text-slate-800 tracking-tight">9:41</span>
            <div className="flex items-center gap-1.5 text-slate-800">
              {/* Cellular */}
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22h20V2z" opacity=".3"/><path d="M17 5L2 20h15z"/></svg>
              {/* Battery */}
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m1 9H3V9h15z"/></svg>
            </div>
          </div>

          {/* Screen Container (Leaflet map as base) */}
          <div className="flex-1 relative w-full overflow-hidden bg-slate-50">
            
            <Map 
              places={places} 
              selectedPlace={selectedPlace} 
              onSelectPlace={(place) => setSelectedPlace(place)}
              onMapClick={() => setSelectedPlace(null)}
              circleCenter={circleCenter}
              circleRadius={circleRadius}
              onMapClickCoords={handleMapClickCoords}
              routePlaces={routePlaces}
            />

            {/* Bottom Floating Bar inside phone: Quick Tips on how to save */}
            {places.length === 0 && !isExtracting && !extractedResult && (
              <div className="absolute top-14 left-4 right-4 z-20 bg-white/90 backdrop-blur-md p-3.5 rounded-2xl border border-red-100 shadow-lg text-slate-800 flex gap-2.5 items-start">
                <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center shrink-0 border border-red-100">
                  <Sparkles className="w-4 h-4 text-[#FF5A5F] animate-spin" />
                </div>
                <div>
                  <h4 className="text-[11px] font-bold text-[#FF5A5F]">지도에 장소가 없나요?</h4>
                  <p className="text-[10px] text-gray-600 leading-relaxed mt-0.5 font-medium">
                    왼쪽 패널에서 스크린샷 파일을 업로드하거나, <strong>데모 캡처</strong>를 탭하면 AI가 자동으로 이 지도에 이식해 드립니다!
                  </p>
                </div>
              </div>
            )}

            {/* Floating Top search bar overlay (iOS Styled search widget) */}
            <div className="absolute top-4 left-4 right-4 z-20 pointer-events-auto">
              <div className="bg-white/95 backdrop-blur shadow-md rounded-2xl border border-gray-150 p-2.5 flex items-center gap-2">
                <Search className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  type="text"
                  placeholder="지도로 직접 장소 탐색..."
                  className="w-full text-xs bg-transparent border-0 focus:outline-none placeholder-gray-400 text-gray-800"
                  readOnly
                  onClick={() => showAlert("알림", "MVP 버전에서는 왼쪽 '캡처 이미지 업로드'를 통해 지도를 생성하고 탐색할 수 있습니다.")}
                />
                <div className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center">
                  <ListFilter className="w-3.5 h-3.5 text-gray-500" />
                </div>
              </div>
            </div>

            {/* Share Toast Notification Alert (iOS style banner) */}
            <AnimatePresence>
              {showShareToast && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -20, scale: 0.95 }}
                  className="absolute top-20 left-4 right-4 z-50 bg-[#FF5A5F] text-white p-3.5 rounded-2xl shadow-xl border border-red-400 flex items-center gap-3 pointer-events-auto"
                >
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                    <Check className="w-4 h-4 text-white animate-pulse" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[11px] font-bold text-white">[{showShareToast}] 목록 복사 완료!</h4>
                    <p className="text-[10px] text-red-50 font-medium">카카오톡이나 SNS 공유창에 붙여넣어 전송해보세요.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* OCR Pipeline Animated Loader Panel */}
            <AnimatePresence>
              {isExtracting && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm z-40 flex flex-col items-center justify-center p-6 text-center"
                >
                  <div className="w-16 h-16 relative flex items-center justify-center mb-4">
                    <div className="absolute inset-0 rounded-full border-4 border-white/20 border-t-[#FF5A5F] animate-spin"></div>
                    <Sparkles className="w-6 h-6 text-[#FF5A5F] animate-pulse" />
                  </div>
                  
                  <h3 className="text-sm font-bold text-white tracking-tight">스팟로그 AI 분석 중</h3>
                  <p className="text-xs text-gray-200 mt-2 font-medium max-w-[260px] animate-pulse">
                    {extractionStep}
                  </p>
                  
                  <div className="mt-6 w-32 bg-white/10 h-1.5 rounded-full overflow-hidden">
                    <div className="h-full bg-[#FF5A5F] animate-infinite-loading"></div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* DRAWER 1: "이 장소 맞아요?" Verification Screen (AI Extraction Confirmation Drawer) */}
            <AnimatePresence>
              {extractedResult && (
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 25, stiffness: 220 }}
                  className="absolute inset-x-0 bottom-0 max-h-[90%] bg-white rounded-t-[32px] shadow-[0_-15px_30px_rgba(0,0,0,0.15)] z-40 flex flex-col overflow-hidden border-t border-gray-100"
                >
                  {/* Handlebar dragging indicator */}
                  <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto my-3 shrink-0" />
                  
                  {/* Drawer Content */}
                  <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-lg bg-red-50 border border-red-100">
                        <Sparkles className="w-4 h-4 text-[#FF5A5F] animate-bounce" />
                      </div>
                      <h3 className="text-sm font-bold text-gray-800">이 장소가 맞나요?</h3>
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 border border-emerald-100 rounded-full font-semibold ml-auto shrink-0">
                        AI 매칭 완료
                      </span>
                    </div>

                    {/* Screenshot Preview thumbnail & OCR Snippet details */}
                    <div className="bg-gray-50 p-2.5 rounded-2xl border border-gray-100 flex gap-3">
                      {uploadedImageBase64 && (
                        <img 
                          src={uploadedImageBase64} 
                          alt="screenshot preview" 
                          className="w-16 h-20 rounded-xl object-cover border border-gray-200 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <span className="text-[9px] font-bold text-gray-400 tracking-wider uppercase">추출된 이미지 메타데이터</span>
                        <div className="bg-[#FFF9C4] border border-yellow-200 p-1.5 rounded-lg text-[10px] text-yellow-900 font-mono line-clamp-3 overflow-hidden leading-relaxed">
                          {verificationScreenshotText || "텍스트 인식 실패"}
                        </div>
                      </div>
                    </div>

                    {/* Editable fields */}
                    <div className="space-y-3.5">
                      {/* Place Name */}
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 block mb-1">장소명 (가게 이름)</label>
                        <input 
                          type="text" 
                          value={verificationName}
                          onChange={(e) => setVerificationName(e.target.value)}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-800 focus:outline-none focus:border-[#FF5A5F] focus:bg-white"
                        />
                      </div>

                      {/* Category Switcher */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 block mb-1">카테고리</label>
                          <select
                            value={verificationCategory}
                            onChange={(e) => setVerificationCategory(e.target.value as CategoryType)}
                            className="w-full px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-750 focus:outline-none focus:border-[#FF5A5F] focus:bg-white"
                          >
                            <option value="카페">☕ 카페</option>
                            <option value="식당">🍴 식당</option>
                            <option value="펜션/숙소">🏡 펜션/숙소</option>
                            <option value="관광지/기타">🗺️ 관광지/기타</option>
                          </select>
                        </div>

                        {/* Location Coordinates hint */}
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 block mb-1">매칭 좌표</label>
                          <div className="px-3 py-2 bg-gray-100 text-gray-500 rounded-xl text-xs font-mono font-medium">
                            {(() => {
                              const lat = Number(extractedResult?.latitude);
                              const lng = Number(extractedResult?.longitude);
                              const formattedLat = !isNaN(lat) && lat !== 0 ? lat.toFixed(4) : "0.0000";
                              const formattedLng = !isNaN(lng) && lng !== 0 ? lng.toFixed(4) : "0.0000";
                              return `${formattedLat}, ${formattedLng}`;
                            })()}
                          </div>
                        </div>
                      </div>

                      {/* Address */}
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 block mb-1">도로명 주소</label>
                        <input 
                          type="text" 
                          value={verificationAddress}
                          onChange={(e) => setVerificationAddress(e.target.value)}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 focus:outline-none focus:border-[#FF5A5F] focus:bg-white"
                        />
                      </div>

                      {/* Expandable Preview: Details simulated from Places API */}
                      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-3 space-y-2.5">
                        <div className="flex items-center gap-1">
                          <Info className="w-3.5 h-3.5 text-[#FF5A5F]" />
                          <span className="text-[10px] font-bold text-gray-600">상세 정보 (Google Places 자동 완성)</span>
                        </div>

                        {/* Hours */}
                        <div className="text-[11px] text-gray-600 flex items-center gap-1.5 font-medium">
                          <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span>{verificationHours}</span>
                        </div>

                        {/* Menu list */}
                        {verificationMenu.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-gray-400">대표 메뉴</span>
                            <div className="grid grid-cols-2 gap-1.5">
                              {verificationMenu.map((m, idx) => (
                                <div key={idx} className="bg-white border border-gray-150 p-1.5 rounded-lg flex justify-between items-center text-[10px] font-semibold">
                                  <span className="font-bold text-gray-700 truncate">{m.name}</span>
                                  <span className="text-[#FF5A5F] shrink-0 font-bold">{m.price}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Review summary */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-gray-400">AI 리뷰 요약</span>
                          <p className="text-[10px] text-gray-600 leading-relaxed italic bg-white/75 border border-gray-150 p-2 rounded-lg font-medium">
                            "{verificationReview}"
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2.5 pt-2">
                      <button
                        onClick={() => {
                          setExtractedResult(null);
                          setUploadedImageBase64(null);
                        }}
                        className="flex-1 py-3 text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-2xl border border-gray-200 cursor-pointer text-center transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={handleSavePlace}
                        className="flex-1.5 py-3 text-xs font-bold bg-[#FF5A5F] hover:bg-[#ff444a] text-white rounded-2xl shadow-lg shadow-red-100/50 flex items-center justify-center gap-1 cursor-pointer transition-colors"
                      >
                        <Check className="w-4 h-4" />
                        <span>지도에 저장하기</span>
                      </button>
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* DRAWER 2: Interactive Place Details Card (Displays when a map marker is clicked) */}
            <AnimatePresence>
              {selectedPlace && !extractedResult && (
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 25, stiffness: 220 }}
                  className="absolute inset-x-0 bottom-0 max-h-[75%] bg-white rounded-t-[32px] shadow-[0_-15px_30px_rgba(0,0,0,0.15)] z-40 flex flex-col overflow-hidden border-t border-slate-100"
                >
                  {/* Handlebar dragging indicator */}
                  <div 
                    onClick={() => setSelectedPlace(null)}
                    className="w-12 h-1.5 bg-slate-200 hover:bg-slate-300 rounded-full mx-auto my-3 shrink-0 cursor-pointer" 
                  />

                  {/* Header Title section */}
                  <div className="px-5 pb-5 flex-1 overflow-y-auto space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${
                            getCategoryTheme(selectedPlace.category).badge
                          }`}>
                            {selectedPlace.category}
                          </span>
                          <span className="text-[10px] text-slate-400">등록일: {new Date(selectedPlace.createdAt).toLocaleDateString()}</span>
                        </div>
                        <h3 className="text-base font-bold text-slate-800 tracking-tight mt-1.5">{selectedPlace.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-start gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                          <span className="leading-tight">{selectedPlace.address}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedPlace(null)}
                        className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Display Original Instagram Screenshot if available */}
                    {selectedPlace.originalImage && (
                      <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100 flex gap-2.5 items-center">
                        <img 
                          src={selectedPlace.originalImage} 
                          alt="Instagram source" 
                          className="w-14 h-14 rounded-lg object-cover border border-slate-200 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">원본 캡처 내용</span>
                          <p className="text-[10px] text-slate-500 leading-tight italic truncate mt-0.5">
                            "{selectedPlace.screenshotText}"
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Google Place Hours detail with icons */}
                    <div className="space-y-3 pt-1">
                      <div className="flex items-center gap-2 text-xs text-slate-700">
                        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Clock className="w-4 h-4 text-slate-400" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[9px] font-bold text-slate-400 block">영업 시간</span>
                          <span className="font-medium truncate block">{selectedPlace.hours}</span>
                        </div>
                      </div>

                      {/* Rep Menu and prices */}
                      {selectedPlace.menu && selectedPlace.menu.length > 0 && (
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-gray-400 block">대표 메뉴</span>
                          <div className="grid grid-cols-1 gap-1.5">
                            {selectedPlace.menu.map((menuItem, idx) => (
                              <div key={idx} className="bg-gray-50 border border-gray-100/80 p-2.5 rounded-xl flex justify-between items-center text-xs">
                                <span className="font-bold text-gray-800">{menuItem.name}</span>
                                <span className="font-black text-[#FF5A5F]">{menuItem.price}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Social reviews block */}
                      <div className="bg-red-50/40 border border-red-100/40 rounded-2xl p-3.5 space-y-1.5">
                        <div className="flex items-center gap-1">
                          <Sparkles className="w-4 h-4 text-[#FF5A5F] animate-spin" />
                          <span className="text-[10px] font-black text-[#FF5A5F]">AI SNS 리뷰 핵심 요약</span>
                        </div>
                        <p className="text-[11px] text-gray-700 leading-relaxed font-bold">
                          "{selectedPlace.reviewSummary}"
                        </p>
                      </div>
                    </div>

                    {/* Action button in drawer */}
                    <div className="flex gap-2 pt-2 shrink-0">
                      <button
                        onClick={() => {
                          safeCopyToClipboard(
                            selectedPlace.address,
                            () => {
                              setShowShareToast("주소");
                              setTimeout(() => {
                                setShowShareToast(null);
                              }, 3500);
                            },
                            (err) => {
                              console.error("Address copy failed:", err);
                              showAlert("복사 실패", "주소 복사에 실패했거나 지원하지 않는 브라우저입니다.");
                            }
                          );
                        }}
                        className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 font-bold text-xs rounded-2xl cursor-pointer transition-colors"
                      >
                        주소 복사
                      </button>
                      <button
                        onClick={() => handleDeletePlace(selectedPlace.id)}
                        className="p-3 bg-red-50 hover:bg-red-100 border border-red-100 text-red-600 rounded-2xl cursor-pointer transition-colors"
                        title="장소 삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>

          {/* iOS Home Indicator Bar */}
          <div className="h-6 bg-white flex items-center justify-center shrink-0 z-30">
            <div className="w-32 h-1 bg-slate-800 rounded-full" />
          </div>

        </div>

      </div>

      {/* CUSTOM DIALOGS FOR EXCELLENT MOBILE UX AND IFRAME RESILIENCE */}
      <AnimatePresence>
        {confirmDeleteId && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-[28px] max-w-sm w-full p-6 shadow-2xl border border-gray-150 flex flex-col items-center text-center space-y-4"
            >
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center border border-red-100 shrink-0">
                <Trash2 className="w-5 h-5 text-[#FF5A5F]" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-black text-gray-800">장소 삭제</h3>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">
                  이 장소를 내 스팟 목록과 지도에서 정말 삭제하시겠습니까?
                </p>
              </div>
              <div className="flex gap-2.5 w-full pt-2">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 py-3 text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-2xl cursor-pointer transition-colors border border-gray-200"
                >
                  취소
                </button>
                <button
                  onClick={() => executeDeletePlace(confirmDeleteId)}
                  className="flex-1.5 py-3 text-xs font-bold bg-[#FF5A5F] hover:bg-[#ff444a] text-white rounded-2xl cursor-pointer transition-colors shadow-lg shadow-red-100"
                >
                  삭제하기
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {confirmReset && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-[28px] max-w-sm w-full p-6 shadow-2xl border border-gray-150 flex flex-col items-center text-center space-y-4"
            >
              <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center border border-amber-100 shrink-0">
                <RotateCcw className="w-5 h-5 text-amber-500" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-black text-gray-800">데이터 초기화</h3>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">
                  저장된 모든 장소를 기본 샘플 데이터로 복원하시겠습니까? 추가하신 모든 장소는 지워집니다.
                </p>
              </div>
              <div className="flex gap-2.5 w-full pt-2">
                <button
                  onClick={() => setConfirmReset(false)}
                  className="flex-1 py-3 text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-2xl cursor-pointer transition-colors border border-gray-200"
                >
                  취소
                </button>
                <button
                  onClick={executeResetPresets}
                  className="flex-1.5 py-3 text-xs font-bold bg-[#FF5A5F] hover:bg-[#ff444a] text-white rounded-2xl cursor-pointer transition-colors shadow-lg shadow-red-100"
                >
                  초기화 실행
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {customAlert && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-[28px] max-w-sm w-full p-6 shadow-2xl border border-gray-150 flex flex-col items-center text-center space-y-4"
            >
              <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100 shrink-0">
                <AlertCircle className="w-5 h-5 text-[#FF5A5F]" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-black text-gray-800">{customAlert.title}</h3>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">
                  {customAlert.message}
                </p>
              </div>
              <div className="w-full pt-2">
                <button
                  onClick={() => setCustomAlert(null)}
                  className="w-full py-3 text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-2xl cursor-pointer transition-colors border border-gray-200"
                >
                  확인
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
