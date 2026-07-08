import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { GoogleMapWebView } from './src/components/GoogleMapWebView';
import { categories, demoScreenshots, demoTexts, initialPlaces } from './src/data/places';
import { isFirebaseDbConfigured, loadPlacesFromFirestore, savePlaceToFirestore } from './src/services/firebaseDb';
import { buildRoute, inferPlaceFromImagePayload, inferPlaceFromText, routeLegs } from './src/utils/inference';
import { styles } from './src/styles';

function Glass({ children, style }) {
  return (
    <BlurView intensity={82} tint="light" style={[styles.glass, style]}>
      {children}
    </BlurView>
  );
}

function iconForCategory(category) {
  return categories.find((item) => item.label === category)?.icon || 'location-outline';
}

function colorForCategory(category) {
  return categories.find((item) => item.label === category)?.color || '#3182F6';
}

function enrichPlace(place) {
  return {
    ...place,
    color: colorForCategory(place.category),
    icon: iconForCategory(place.category),
  };
}

function normalizeMenu(menu) {
  if (Array.isArray(menu)) {
    return menu.map((item) => `${item.name}${item.price ? ` ${item.price}` : ''}`).join(', ');
  }
  return String(menu || '');
}

function normalizeExtractedPlace(payload, fallbackImage) {
  const source = payload?.place || payload || inferPlaceFromImagePayload(fallbackImage);
  return {
    ...source,
    menu: normalizeMenu(source.menu),
    originalImage: fallbackImage,
  };
}

export default function App() {
  const mapRef = useRef(null);
  const [tab, setTab] = useState('map');
  const [places, setPlaces] = useState(initialPlaces);
  const [selectedPlace, setSelectedPlace] = useState(initialPlaces[0]);
  const [detailSheetVisible, setDetailSheetVisible] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('전체');
  const [extractText, setExtractText] = useState(demoTexts[0]);
  const [extracting, setExtracting] = useState(false);
  const [extractStep, setExtractStep] = useState('');
  const [uploadedImage, setUploadedImage] = useState(null);
  const [extractResult, setExtractResult] = useState(null);
  const [verification, setVerification] = useState(null);
  const [routePlaces, setRoutePlaces] = useState(buildRoute(initialPlaces.slice(0, 4)));
  const [toast, setToast] = useState('');
  const [userLocation, setUserLocation] = useState(null);
  const [mapStatus, setMapStatus] = useState({ status: 'idle', message: '' });
  const [routeInfo, setRouteInfo] = useState({ status: 'idle', durationText: '', distanceText: '' });

  const visiblePlaces = useMemo(() => {
    return places.filter((place) => {
      const categoryMatched = category === '전체' || place.category === category;
      const text = `${place.name} ${place.address} ${place.category}`.toLowerCase();
      const queryMatched = !query.trim() || text.includes(query.trim().toLowerCase());
      return categoryMatched && queryMatched;
    });
  }, [places, category, query]);

  const mapPlaces = useMemo(() => visiblePlaces.map(enrichPlace), [visiblePlaces]);
  const mapSelectedPlace = useMemo(() => enrichPlace(selectedPlace), [selectedPlace]);
  const legs = useMemo(() => routeLegs(routePlaces), [routePlaces]);

  useEffect(() => {
    let isMounted = true;

    async function hydratePlaces() {
      if (!isFirebaseDbConfigured()) return;
      try {
        const remotePlaces = await loadPlacesFromFirestore();
        if (isMounted && remotePlaces.length > 0) {
          setPlaces(remotePlaces);
          setSelectedPlace(remotePlaces[0]);
          setDetailSheetVisible(true);
          setRoutePlaces(buildRoute(remotePlaces.slice(0, 4)));
        }
      } catch (error) {
        console.warn('Failed to load Firestore places', error);
      }
    }

    async function loadLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (isMounted) setMapStatus({ status: 'location-denied', message: '위치 권한이 꺼져 있어요.' });
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (isMounted) {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      }
    }

    hydratePlaces();
    loadLocation().catch(() => {
      if (isMounted) setMapStatus({ status: 'location-error', message: '현재 위치를 가져오지 못했어요.' });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(''), 1700);
  }

  async function runTextExtraction(text = extractText) {
    setExtracting(true);
    setExtractStep('캡션 텍스트에서 장소 후보를 분석 중...');
    setExtractResult(null);
    setVerification(null);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const result = inferPlaceFromText(text);
    setExtractResult(result);
    setVerification({ ...result, originalImage: uploadedImage, provider: 'local-text' });
    setExtracting(false);
  }

  async function pickScreenshot() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast('사진 접근 권한이 필요해요');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.82,
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const imagePayload = asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : asset.uri;
    setUploadedImage(imagePayload);
    triggerCaptureExtraction(imagePayload);
  }

  async function triggerCaptureExtraction(imagePayload, promptHint = '') {
    setExtracting(true);
    setExtractResult(null);
    setVerification(null);

    const steps = [
      '스크린샷 이미지를 서버로 전송 중...',
      'Gemini가 이미지 속 텍스트와 장소 단서를 분석 중...',
      '장소명, 주소, 카테고리, 좌표를 JSON으로 정리 중...',
      '검증 폼에 분석 결과를 채우는 중...',
    ];

    let stepIndex = 0;
    setExtractStep(steps[stepIndex]);
    const interval = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, steps.length - 1);
      setExtractStep(steps[stepIndex]);
    }, 1000);

    try {
      const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
      if (!apiBase) throw new Error('EXPO_PUBLIC_API_BASE_URL이 비어 있습니다.');

      const response = await Promise.race([
        fetch(`${apiBase.replace(/\/$/, '')}/api/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imagePayload, promptHint }),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('server timeout')), 20000)),
      ]);

      const payload = await response.json();
      const result = normalizeExtractedPlace(payload, imagePayload);
      setExtractResult(result);
      setVerification(result);

      if (result.provider === 'gemini') {
        showToast('Gemini 이미지 분석 완료');
      } else if (result.geminiError) {
        showToast('Gemini 실패, fallback 결과 표시');
      } else {
        showToast('이미지 분석 결과 표시');
      }
    } catch (error) {
      const fallback = inferPlaceFromImagePayload(promptHint || imagePayload);
      setExtractResult(fallback);
      setVerification({ ...fallback, originalImage: imagePayload, provider: 'local-fallback' });
      showToast('서버 연결 실패, 앱 내부 추론으로 표시');
    } finally {
      clearInterval(interval);
      setExtracting(false);
    }
  }

  function saveExtracted() {
    const source = verification || extractResult;
    if (!source?.name) return;

    const nextPlace = {
      ...source,
      id: `place-${Date.now()}`,
      latitude: Number(source.latitude) || 37.5446,
      longitude: Number(source.longitude) || 127.0559,
      confidence: source.confidence || 0.9,
      screenshotText: source.screenshotText || extractText,
      originalImage: source.originalImage || uploadedImage,
    };

    setPlaces((current) => [nextPlace, ...current]);
    savePlaceToFirestore(nextPlace)
      .then(() => showToast(`${nextPlace.name} DB 저장 완료`))
      .catch(() => showToast('지도 저장 완료, DB 저장은 실패했어요'));
    setSelectedPlace(nextPlace);
    setDetailSheetVisible(true);
    setUploadedImage(null);
    setExtractResult(null);
    setVerification(null);
    setTab('map');
    showToast(`${nextPlace.name} 저장 완료`);
  }

  function makeRoute() {
    const nextRoute = buildRoute(visiblePlaces.slice(0, 5));
    setRoutePlaces(nextRoute.length >= 2 ? nextRoute : buildRoute(places.slice(0, 4)));
    setTab('route');
  }

  function handleMapSelectPlace(placeId) {
    const nextPlace = places.find((place) => place.id === placeId);
    if (nextPlace) {
      setSelectedPlace(nextPlace);
      setDetailSheetVisible(true);
    }
  }

  function updateVerification(key, value) {
    setVerification((current) => ({ ...(current || {}), [key]: value }));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      {tab === 'map' && (
        <View style={styles.mapScreen}>
          <GoogleMapWebView
            ref={mapRef}
            places={mapPlaces}
            selectedPlace={mapSelectedPlace}
            userLocation={userLocation}
            onSelectPlace={handleMapSelectPlace}
            onMapPress={() => setDetailSheetVisible(false)}
            onStatusChange={setMapStatus}
            onRouteChange={setRouteInfo}
          />

          <TouchableOpacity style={styles.searchBox} activeOpacity={0.92}>
            <Glass style={styles.searchGlass}>
              <Ionicons name="search" size={20} color="#3182F6" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="장소, 주소, 카테고리 검색"
                placeholderTextColor="#8B95A1"
                style={styles.searchInput}
              />
            </Glass>
          </TouchableOpacity>

          <View style={styles.categoryRail}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRailContent}>
              {categories.map((item) => (
                <TouchableOpacity
                  key={item.label}
                  onPress={() => setCategory(item.label)}
                  style={[styles.categoryChip, category === item.label && styles.categoryChipOn]}
                >
                  <Ionicons name={item.icon} size={15} color={category === item.label ? '#FFFFFF' : item.color} />
                  <Text style={[styles.categoryChipText, category === item.label && styles.categoryChipTextOn]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {mapStatus.status !== 'ready' && mapStatus.message ? (
            <Glass style={styles.mapStatusBadge}>
              <Ionicons name={mapStatus.status === 'error' ? 'warning-outline' : 'sync-outline'} size={16} color={mapStatus.status === 'error' ? '#FF3B30' : '#3182F6'} />
              <Text style={styles.mapStatusText} numberOfLines={2}>{mapStatus.message}</Text>
            </Glass>
          ) : null}

          <View style={styles.mapControlStack}>
            <TouchableOpacity activeOpacity={0.84} onPress={() => mapRef.current?.runMapCommand('fitPlaces')}>
              <Glass style={styles.mapRoundButton}>
                <Ionicons name="scan-outline" size={21} color="#191F28" />
              </Glass>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.84} onPress={() => mapRef.current?.runMapCommand('centerUser')}>
              <Glass style={styles.mapRoundButton}>
                <Ionicons name="navigate" size={21} color="#3182F6" />
              </Glass>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.fab} activeOpacity={0.88} onPress={makeRoute}>
            <Ionicons name="git-merge-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>

          {selectedPlace && detailSheetVisible && (
            <Glass style={styles.detailSheet}>
              <View style={styles.detailTop}>
                <View style={[styles.detailIcon, { backgroundColor: colorForCategory(selectedPlace.category) }]}>
                  <Ionicons name={iconForCategory(selectedPlace.category)} size={20} color="#FFFFFF" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.detailTitle}>{selectedPlace.name}</Text>
                  <Text style={styles.detailMeta}>
                    {selectedPlace.category} · AI {Math.round((selectedPlace.confidence || 0.85) * 100)}%
                    {routeInfo.status === 'ready' && routeInfo.durationText ? ` · ${routeInfo.durationText}` : ''}
                  </Text>
                </View>
              </View>
              <Text style={styles.detailDesc}>{selectedPlace.reviewSummary}</Text>
              <View style={styles.infoGrid}>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>영업시간</Text>
                  <Text style={styles.infoText}>{selectedPlace.hours}</Text>
                </View>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>대표 메뉴</Text>
                  <Text style={styles.infoText}>{normalizeMenu(selectedPlace.menu)}</Text>
                </View>
              </View>
            </Glass>
          )}
        </View>
      )}

      {tab === 'collect' && (
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>캡처 이미지 업로드</Text>
          <Glass style={styles.card}>
            <View style={styles.badge}>
              <Ionicons name="image-outline" size={15} color="#3182F6" />
              <Text style={styles.badgeText}>Gemini 이미지 분석</Text>
            </View>
            <Text style={styles.cardTitle}>인스타/지도 캡처 한 장을 올리면 Gemini가 장소 정보를 추출합니다.</Text>

            <TouchableOpacity style={styles.captureDrop} activeOpacity={0.86} onPress={pickScreenshot}>
              <Ionicons name="cloud-upload-outline" size={28} color="#3182F6" />
              <Text style={styles.captureDropTitle}>캡처 이미지 선택</Text>
              <Text style={styles.captureDropSub}>앨범에서 스크린샷을 고르면 서버의 Gemini API로 분석합니다.</Text>
            </TouchableOpacity>

            {uploadedImage ? (
              <View style={styles.capturePreview}>
                <Image source={{ uri: uploadedImage }} style={styles.captureImage} />
                <View style={styles.capturePreviewInfo}>
                  <Text style={styles.resultConfidence}>원본 캡처</Text>
                  <Text style={styles.detailDesc} numberOfLines={2}>이미지 분석 결과가 아래 검증 폼에 표시됩니다.</Text>
                </View>
              </View>
            ) : null}

            <Text style={styles.settingDesc}>원클릭 데모 캡처로 즉시 테스트해보세요.</Text>
            <View style={styles.demoRow}>
              {demoScreenshots.map((demo, index) => (
                <TouchableOpacity
                  key={demo.name}
                  style={styles.demoChip}
                  onPress={() => {
                    setUploadedImage(demo.imageUrl);
                    triggerCaptureExtraction(demo.imageUrl, demo.promptHint);
                  }}
                >
                  <Text style={styles.demoChipText}>데모 {index + 1}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {extracting ? (
              <View style={styles.extractingBox}>
                <ActivityIndicator color="#3182F6" />
                <Text style={styles.extractingText}>{extractStep}</Text>
              </View>
            ) : null}
          </Glass>

          <Glass style={styles.card}>
            <View style={styles.badge}>
              <Ionicons name="sparkles" size={15} color="#3182F6" />
              <Text style={styles.badgeText}>캡션 텍스트 보조 분석</Text>
            </View>
            <TextInput
              multiline
              value={extractText}
              onChangeText={setExtractText}
              style={styles.textArea}
              placeholder="공유 URL 또는 캡션 텍스트"
              placeholderTextColor="#8B95A1"
            />
            <TouchableOpacity style={styles.primaryButton} onPress={() => runTextExtraction()}>
              <Ionicons name="search" size={18} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>텍스트로 분석하기</Text>
            </TouchableOpacity>
          </Glass>

          {verification && (
            <Glass style={styles.card}>
              <Text style={styles.resultConfidence}>
                {verification.provider === 'gemini' ? 'Gemini 분석' : verification.geminiError ? 'Fallback 분석' : '자동 추론'} · {Math.round((verification.confidence || 0.9) * 100)}%
              </Text>
              {verification.geminiError ? <Text style={styles.settingDesc}>Gemini 오류: {verification.geminiError}</Text> : null}
              <Text style={styles.resultTitle}>검증 후 저장</Text>

              <Text style={styles.fieldLabel}>장소명</Text>
              <TextInput value={verification.name} onChangeText={(value) => updateVerification('name', value)} style={styles.fieldInput} />

              <Text style={styles.fieldLabel}>카테고리</Text>
              <View style={styles.demoRow}>
                {categories.filter((item) => item.label !== '전체').map((item) => (
                  <TouchableOpacity key={item.label} onPress={() => updateVerification('category', item.label)} style={[styles.categoryChip, verification.category === item.label && styles.categoryChipOn]}>
                    <Text style={[styles.categoryChipText, verification.category === item.label && styles.categoryChipTextOn]}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>주소</Text>
              <TextInput value={verification.address} onChangeText={(value) => updateVerification('address', value)} style={styles.fieldInput} />

              <Text style={styles.fieldLabel}>영업시간</Text>
              <TextInput value={verification.hours} onChangeText={(value) => updateVerification('hours', value)} style={styles.fieldInput} />

              <Text style={styles.fieldLabel}>대표 메뉴</Text>
              <TextInput value={normalizeMenu(verification.menu)} onChangeText={(value) => updateVerification('menu', value)} style={styles.fieldInput} />

              <Text style={styles.fieldLabel}>AI 리뷰 요약</Text>
              <TextInput multiline value={verification.reviewSummary} onChangeText={(value) => updateVerification('reviewSummary', value)} style={[styles.fieldInput, styles.fieldArea]} />

              <Text style={styles.fieldLabel}>원본 캡처 내용</Text>
              <TextInput multiline value={verification.screenshotText} onChangeText={(value) => updateVerification('screenshotText', value)} style={[styles.fieldInput, styles.fieldArea]} />

              <TouchableOpacity style={styles.primaryButton} onPress={saveExtracted}>
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>지도에 저장하기</Text>
              </TouchableOpacity>
            </Glass>
          )}
        </ScrollView>
      )}

      {tab === 'route' && (
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>스마트 동선</Text>
          <Glass style={styles.card}>
            <View style={styles.badge}>
              <Ionicons name="git-merge-outline" size={15} color="#3182F6" />
              <Text style={styles.badgeText}>구역 묶기</Text>
            </View>
            <Text style={styles.cardTitle}>현재 필터에 보이는 장소를 가까운 순서로 정렬했습니다.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={makeRoute}>
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>현재 필터로 다시 묶기</Text>
            </TouchableOpacity>
          </Glass>

          {routePlaces.map((place, index) => (
            <View key={place.id}>
              <Glass style={styles.routeItem}>
                <View style={styles.routeIndex}>
                  <Text style={styles.routeIndexText}>{index + 1}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.routeTitle}>{place.name}</Text>
                  <Text style={styles.routeMeta}>{place.category} · {place.address}</Text>
                </View>
              </Glass>
              {legs[index] && (
                <View style={styles.legBox}>
                  <Ionicons name="arrow-down" size={16} color="#3182F6" />
                  <Text style={styles.legText}>{legs[index].mode} · {legs[index].durationMin}분 · {legs[index].distanceKm.toFixed(1)}km</Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {tab === 'plan' && (
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>AI 일정표</Text>
          <Glass style={styles.card}>
            <View style={styles.badge}>
              <Ionicons name="calendar-outline" size={15} color="#3182F6" />
              <Text style={styles.badgeText}>오늘의 코스</Text>
            </View>
            <Text style={styles.cardTitle}>동선 순서를 하루 일정표로 바꾸었습니다.</Text>
          </Glass>

          {(routePlaces.length ? routePlaces : places.slice(0, 4)).map((place, index) => (
            <Glass key={place.id} style={styles.timelineItem}>
              <Text style={styles.timelineTime}>{`${10 + index * 2}:00`.padStart(5, '0')}</Text>
              <View style={styles.flex}>
                <Text style={styles.routeTitle}>{place.name}</Text>
                <Text style={styles.routeMeta}>{place.category} 방문 · {place.hours}</Text>
              </View>
            </Glass>
          ))}
        </ScrollView>
      )}

      {tab === 'settings' && (
        <ScrollView contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>설정</Text>
          <Glass style={styles.card}>
            <Text style={styles.cardTitle}>PinSnap Archive</Text>
            <Text style={styles.detailDesc}>캡처 이미지는 서버의 Gemini API로 분석하고, 실패하면 앱 내부 fallback을 표시합니다.</Text>
          </Glass>
        </ScrollView>
      )}

      <Glass style={styles.tabBar}>
        {[
          ['map', '지도', 'map-outline'],
          ['collect', '캡처', 'image-outline'],
          ['route', '동선', 'git-merge-outline'],
          ['plan', '일정', 'calendar-outline'],
          ['settings', '설정', 'settings-outline'],
        ].map(([key, label, icon]) => {
          const active = tab === key;
          return (
            <TouchableOpacity key={key} style={styles.tab} onPress={() => setTab(key)}>
              <Ionicons name={icon} size={21} color={active ? '#3182F6' : '#8B95A1'} />
              <Text style={[styles.tabText, active && styles.tabTextOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </Glass>

      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
