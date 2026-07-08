import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { styles } from '../styles';

function normalizePlace(place) {
  return {
    ...place,
    lat: place.lat ?? place.latitude,
    lng: place.lng ?? place.longitude,
  };
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildMapHtml({ apiKey, mapId, places, selectedPlace, userLocation }) {
  const normalizedPlaces = places.map(normalizePlace).filter((place) => place.lat && place.lng);
  const activePlace = normalizePlace(selectedPlace || normalizedPlaces[0] || {});
  const center = userLocation || activePlace || { lat: 37.5665, lng: 126.978 };
  const mapIdOption = mapId ? `mapId: ${JSON.stringify(mapId)},` : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="initial-scale=1, maximum-scale=1, user-scalable=no, width=device-width" />
    <style>
      html, body, #map {
        height: 100%;
        width: 100%;
        margin: 0;
        padding: 0;
        background: #e9eef3;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .gm-style-cc, a[href^="https://maps.google.com/maps"] { opacity: .35; }
    </style>
    <script>
      window.report = function(payload) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      };
      window.gm_authFailure = function() {
        window.report({ type: 'mapError', message: 'Google Maps API 키 또는 제한 설정을 확인해 주세요.' });
      };
      window.onerror = function(message) {
        window.report({ type: 'mapError', message: String(message || '지도 스크립트 오류') });
      };

      function initMap() {
        var places = ${safeJson(normalizedPlaces)};
        var selectedPlace = ${safeJson(activePlace)};
        var userLocation = ${safeJson(userLocation || null)};
        var map = new google.maps.Map(document.getElementById('map'), {
          center: { lat: ${Number(center.lat)}, lng: ${Number(center.lng)} },
          zoom: userLocation ? 15 : 13,
          ${mapIdOption}
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          clickableIcons: true,
          styles: [
            { featureType: 'poi.business', stylers: [{ visibility: 'on' }] },
            { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#bfe4ff' }] },
            { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#eef4e6' }] }
          ]
        });

        var bounds = new google.maps.LatLngBounds();
        var directionsService = new google.maps.DirectionsService();
        var directionsRenderer = new google.maps.DirectionsRenderer({
          map: map,
          suppressMarkers: true,
          preserveViewport: true,
          polylineOptions: {
            strokeColor: '#3182F6',
            strokeOpacity: 0.95,
            strokeWeight: 7
          }
        });
        var markerClickPending = false;

        function point(place) {
          return { lat: Number(place.lat), lng: Number(place.lng) };
        }

        function markerIcon(color, scale) {
          return {
            path: google.maps.SymbolPath.CIRCLE,
            scale: scale,
            fillColor: color || '#3182F6',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 4
          };
        }

        places.forEach(function(place) {
          if (!place.lat || !place.lng) return;
          var position = point(place);
          bounds.extend(position);
          var marker = new google.maps.Marker({
            position: position,
            map: map,
            title: place.name,
            zIndex: selectedPlace && selectedPlace.id === place.id ? 30 : 10,
            icon: markerIcon(place.color, selectedPlace && selectedPlace.id === place.id ? 13 : 10)
          });
          marker.addListener('click', function() {
            markerClickPending = true;
            window.report({ type: 'selectPlace', id: place.id });
            setTimeout(function() { markerClickPending = false; }, 0);
          });
        });

        map.addListener('click', function() {
          if (markerClickPending) {
            markerClickPending = false;
            return;
          }
          window.report({ type: 'mapPress' });
        });

        if (userLocation) {
          bounds.extend(userLocation);
          new google.maps.Marker({
            position: userLocation,
            map: map,
            title: '내 위치',
            zIndex: 99,
            icon: markerIcon('#0A84FF', 9)
          });
        }

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, 70);
        }

        function calculateRoute() {
          if (!userLocation || !selectedPlace || !selectedPlace.lat || !selectedPlace.lng) {
            window.report({ type: 'routeInfo', durationText: '', distanceText: '', status: 'idle' });
            return;
          }

          directionsService.route({
            origin: userLocation,
            destination: point(selectedPlace),
            travelMode: google.maps.TravelMode.WALKING,
            provideRouteAlternatives: false
          }, function(result, status) {
            if (status !== 'OK' || !result || !result.routes || !result.routes[0]) {
              window.report({ type: 'routeError', message: '현재 위치 기준 경로를 찾지 못했습니다.', statusCode: status });
              return;
            }
            directionsRenderer.setDirections(result);
            var leg = result.routes[0].legs && result.routes[0].legs[0];
            window.report({
              type: 'routeInfo',
              status: 'ready',
              durationText: leg && leg.duration ? leg.duration.text : '',
              distanceText: leg && leg.distance ? leg.distance.text : ''
            });
          });
        }

        calculateRoute();

        window.hotplaceMap = {
          centerActive: function() {
            if (selectedPlace && selectedPlace.lat && selectedPlace.lng) {
              map.panTo(point(selectedPlace));
              map.setZoom(Math.max(map.getZoom() || 14, 15));
            }
          },
          centerUser: function() {
            if (userLocation) {
              map.panTo(userLocation);
              map.setZoom(16);
            }
          },
          fitPlaces: function() {
            if (!bounds.isEmpty()) map.fitBounds(bounds, 70);
          }
        };

        window.report({ type: 'mapReady' });
      }
    </script>
    <script async defer src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=places&callback=initMap" onerror="window.report({ type: 'mapError', message: 'Google Maps JavaScript API를 불러오지 못했습니다.' })"></script>
  </head>
  <body><div id="map"></div></body>
</html>`;
}

export const GoogleMapWebView = forwardRef(function GoogleMapWebView(
  { places, selectedPlace, userLocation, onSelectPlace, onMapPress, onStatusChange, onRouteChange },
  ref
) {
  const webViewRef = useRef(null);
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_JAVASCRIPT_API_KEY;
  const mapId = process.env.EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID;
  const baseUrl = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEBVIEW_BASE_URL || 'https://hotplace.local';

  const html = useMemo(() => {
    if (!apiKey) return '';
    return buildMapHtml({ apiKey, mapId, places, selectedPlace, userLocation });
  }, [apiKey, mapId, places, selectedPlace, userLocation]);

  useImperativeHandle(ref, () => ({
    runMapCommand(command) {
      webViewRef.current?.injectJavaScript(`
        if (window.hotplaceMap && window.hotplaceMap.${command}) {
          window.hotplaceMap.${command}();
        }
        true;
      `);
    },
  }));

  if (!apiKey) {
    return (
      <View style={styles.mapFallback}>
        <Text style={styles.mapFallbackTitle}>Google Maps API 키가 필요합니다</Text>
        <Text style={styles.mapFallbackText}>mobile/.env에 EXPO_PUBLIC_GOOGLE_MAPS_JAVASCRIPT_API_KEY를 넣으면 실제 지도가 표시됩니다.</Text>
      </View>
    );
  }

  return (
    <View style={styles.googleMapLayer}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html, baseUrl }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled
        bounces={false}
        allowsInlineMediaPlayback
        onLoadStart={() => onStatusChange?.({ status: 'loading', message: '지도를 불러오는 중' })}
        onError={(event) => {
          onStatusChange?.({
            status: 'error',
            message: event.nativeEvent.description || '지도를 불러오지 못했습니다.',
          });
        }}
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data);
            if (payload.type === 'selectPlace') {
              onSelectPlace?.(payload.id);
            }
            if (payload.type === 'mapPress') {
              onMapPress?.();
            }
            if (payload.type === 'mapReady') {
              onStatusChange?.({ status: 'ready', message: '지도 준비 완료' });
            }
            if (payload.type === 'mapError') {
              onStatusChange?.({ status: 'error', message: payload.message });
            }
            if (payload.type === 'routeInfo') {
              onRouteChange?.(payload);
            }
            if (payload.type === 'routeError') {
              onRouteChange?.({ status: 'error', message: payload.message });
            }
          } catch {
            // Ignore malformed bridge messages.
          }
        }}
      />
    </View>
  );
});
