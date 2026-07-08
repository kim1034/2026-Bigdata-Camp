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
      #routeCircleOverlay {
        position: absolute;
        display: none;
        border: 2px solid #111827;
        background: rgba(49, 130, 246, 0.08);
        border-radius: 9999px;
        pointer-events: none;
        z-index: 7;
        box-sizing: border-box;
        transform: translate(-50%, -50%);
      }
    </style>
    <script>
      window.report = function(payload) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      };
      window.gm_authFailure = function() {
        window.report({ type: 'mapError', message: 'Google Maps API ???먮뒗 ?쒗븳 ?ㅼ젙???뺤씤??二쇱꽭??' });
      };
      window.onerror = function(message) {
        window.report({ type: 'mapError', message: String(message || '吏???ㅽ겕由쏀듃 ?ㅻ쪟') });
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
          isFractionalZoomEnabled: true,
          clickableIcons: true,
          styles: [
            { featureType: 'poi.business', stylers: [{ visibility: 'on' }] },
            { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
            { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#bfe4ff' }] },
            { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#eef4e6' }] }
          ]
        });

        var bounds = new google.maps.LatLngBounds();
        var placesService = new google.maps.places.PlacesService(map);
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
        var routeCircle = null;
        var routeExplorePolyline = null;
        var routeCircleOverlay = document.getElementById('routeCircleOverlay');
        var projectionHelper = new google.maps.OverlayView();
        projectionHelper.onAdd = function() {};
        projectionHelper.draw = function() {};
        projectionHelper.onRemove = function() {};
        projectionHelper.setMap(map);

        function point(place) {
          return { lat: Number(place.lat), lng: Number(place.lng) };
        }

        function markerIcon(color, scale) {
          var fillColor = color || '#3182F6';
          var isWhitePin = String(fillColor).toLowerCase() === '#ffffff' || String(fillColor).toLowerCase() === 'white';
          return {
            path: google.maps.SymbolPath.CIRCLE,
            scale: scale,
            fillColor: fillColor,
            fillOpacity: 1,
            strokeColor: isWhitePin ? '#111827' : '#ffffff',
            strokeWeight: isWhitePin ? 3 : 4
          };
        }

        function distanceMeters(a, b) {
          var earthRadius = 6371000;
          var dLat = (b.lat - a.lat) * Math.PI / 180;
          var dLng = (b.lng - a.lng) * Math.PI / 180;
          var lat1 = a.lat * Math.PI / 180;
          var lat2 = b.lat * Math.PI / 180;
          var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
          return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
        }

        function metersPerPixel(lat) {
          return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom() || 13);
        }

        function selectRouteCircle(x, y, radiusPx) {
          var projection = projectionHelper.getProjection && projectionHelper.getProjection();
          if (!projection) {
            window.report({ type: 'routeCircleSelected', ids: [], message: '吏?꾨? 以鍮꾪븯??以묒엯?덈떎.' });
            return;
          }

          var centerLatLng = projection.fromContainerPixelToLatLng(new google.maps.Point(Number(x), Number(y)));
          var center = { lat: centerLatLng.lat(), lng: centerLatLng.lng() };
          var visualRadius = Number(radiusPx || 92);
          var radiusMeters = Math.max(120, visualRadius * metersPerPixel(center.lat));

          if (routeCircleOverlay) {
            routeCircleOverlay.style.display = 'block';
            routeCircleOverlay.style.width = (visualRadius * 2) + 'px';
            routeCircleOverlay.style.height = (visualRadius * 2) + 'px';
            routeCircleOverlay.style.left = Number(x) + 'px';
            routeCircleOverlay.style.top = Number(y) + 'px';
          }

          if (routeCircle) routeCircle.setMap(null);
          routeCircle = new google.maps.Circle({
            map: map,
            center: center,
            radius: radiusMeters,
            strokeColor: '#111827',
            strokeOpacity: 0,
            strokeWeight: 2,
            fillColor: '#3182F6',
            fillOpacity: 0,
            clickable: false
          });

          var selectedIds = places
            .filter(function(place) {
              return place.lat && place.lng && distanceMeters(center, { lat: Number(place.lat), lng: Number(place.lng) }) <= radiusMeters;
            })
            .map(function(place) { return place.id; });

          window.report({
            type: 'routeCircleSelected',
            ids: selectedIds,
            center: center,
            radiusMeters: radiusMeters
          });
        }

        function panByInstant(x, y) {
          var projection = projectionHelper.getProjection && projectionHelper.getProjection();
          if (!projection) {
            map.panBy(Number(x) || 0, Number(y) || 0);
            return;
          }
          var centerPoint = projection.fromLatLngToDivPixel(map.getCenter());
          var nextPoint = new google.maps.Point(
            centerPoint.x + (Number(x) || 0),
            centerPoint.y + (Number(y) || 0)
          );
          var nextCenter = projection.fromDivPixelToLatLng(nextPoint);
          if (nextCenter) map.setCenter(nextCenter);
        }

        function zoomBy(delta) {
          var currentZoom = Number(map.getZoom() || 13);
          var nextZoom = Math.max(3, Math.min(21, currentZoom + (Number(delta) || 0)));
          map.setZoom(nextZoom);
        }

        function clearRoutePolyline() {
          if (routeExplorePolyline) {
            routeExplorePolyline.setMap(null);
            routeExplorePolyline = null;
          }
        }

        function renderRoutePolyline(encodedPolyline) {
          clearRoutePolyline();
          if (!encodedPolyline || !google.maps.geometry || !google.maps.geometry.encoding) {
            window.report({ type: 'routeError', message: '寃쎈줈 ?좎쓣 洹몃┫ ???놁뒿?덈떎.' });
            return;
          }

          var path = google.maps.geometry.encoding.decodePath(encodedPolyline);
          if (!path || !path.length) {
            window.report({ type: 'routeError', message: '寃쎈줈 醫뚰몴媛 鍮꾩뼱 ?덉뒿?덈떎.' });
            return;
          }

          directionsRenderer.setMap(null);
          routeExplorePolyline = new google.maps.Polyline({
            path: path,
            geodesic: true,
            map: map,
            strokeColor: '#E53935',
            strokeOpacity: 1,
            strokeWeight: 5,
            zIndex: 900
          });

          var routeBounds = new google.maps.LatLngBounds();
          path.forEach(function(latLng) { routeBounds.extend(latLng); });
          if (!routeBounds.isEmpty()) map.fitBounds(routeBounds, 72);
        }

        function readPhotoUrl(place) {
          if (!place.photos || !place.photos[0] || !place.photos[0].getUrl) return '';
          try {
            return place.photos[0].getUrl({ maxWidth: 640, maxHeight: 420 });
          } catch (error) {
            return '';
          }
        }

        function selectGooglePoi(event) {
          if (!event || !event.placeId) return false;
          if (event.stop) event.stop();

          placesService.getDetails({
            placeId: event.placeId,
            fields: [
              'place_id',
              'name',
              'geometry',
              'formatted_address',
              'types',
              'rating',
              'user_ratings_total',
              'opening_hours',
              'photos'
            ]
          }, function(place, status) {
            var fallbackLocation = event.latLng ? { lat: event.latLng.lat(), lng: event.latLng.lng() } : null;
            if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
              window.report({
                type: 'externalPlace',
                place: {
                  id: 'google-' + event.placeId,
                  googlePlaceId: event.placeId,
                  name: 'Google 지도 장소',
                  address: '',
                  latitude: fallbackLocation ? fallbackLocation.lat : 0,
                  longitude: fallbackLocation ? fallbackLocation.lng : 0,
                  googleTypes: [],
                  provider: 'google'
                }
              });
              return;
            }

            var location = place.geometry && place.geometry.location
              ? { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() }
              : fallbackLocation;
            window.report({
              type: 'externalPlace',
              place: {
                id: 'google-' + (place.place_id || event.placeId),
                googlePlaceId: place.place_id || event.placeId,
                name: place.name || 'Google 지도 장소',
                address: place.formatted_address || '',
                latitude: location ? location.lat : 0,
                longitude: location ? location.lng : 0,
                rating: place.rating || null,
                userRatingsTotal: place.user_ratings_total || null,
                hours: place.opening_hours && place.opening_hours.weekday_text ? place.opening_hours.weekday_text.join('\\n') : '',
                photoUrl: readPhotoUrl(place),
                googleTypes: place.types || [],
                provider: 'google'
              }
            });
          });
          return true;
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

        map.addListener('click', function(event) {
          if (markerClickPending) {
            markerClickPending = false;
            return;
          }
          if (selectGooglePoi(event)) return;
          window.report({ type: 'mapPress' });
        });

        if (userLocation) {
          bounds.extend(userLocation);
          new google.maps.Marker({
            position: userLocation,
            map: map,
            title: '???꾩튂',
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
              window.report({ type: 'routeError', message: '?꾩옱 ?꾩튂 湲곗? 寃쎈줈瑜?李얠? 紐삵뻽?듬땲??', statusCode: status });
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

        window.report({ type: 'routeInfo', durationText: '', distanceText: '', status: 'idle' });

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
          panBy: function(x, y) {
            panByInstant(x, y);
          },
          zoomBy: zoomBy,
          renderRoutePolyline: renderRoutePolyline,
          clearRoutePolyline: clearRoutePolyline,
          selectRouteCircle: selectRouteCircle,
          clearRouteCircle: function() {
            if (routeCircle) {
              routeCircle.setMap(null);
              routeCircle = null;
            }
            if (routeCircleOverlay) {
              routeCircleOverlay.style.display = 'none';
            }
          },
          fitPlaces: function() {
            if (!bounds.isEmpty()) map.fitBounds(bounds, 70);
          }
        };

        window.report({ type: 'mapReady' });
      }
    </script>
    <script async defer src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=places,geometry&callback=initMap" onerror="window.report({ type: 'mapError', message: 'Google Maps JavaScript API瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??' })"></script>
  </head>
  <body><div id="map"></div><div id="routeCircleOverlay"></div></body>
</html>`;
}

export const GoogleMapWebView = forwardRef(function GoogleMapWebView(
  { places, selectedPlace, userLocation, onSelectPlace, onExternalPlace, onMapPress, onStatusChange, onRouteChange, onRouteCircleSelected },
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
    panBy(x, y) {
      webViewRef.current?.injectJavaScript(`
        if (window.hotplaceMap && window.hotplaceMap.panBy) {
          window.hotplaceMap.panBy(${Number(x) || 0}, ${Number(y) || 0});
        }
        true;
      `);
    },
    zoomBy(delta) {
      webViewRef.current?.injectJavaScript(`
        if (window.hotplaceMap && window.hotplaceMap.zoomBy) {
          window.hotplaceMap.zoomBy(${Number(delta) || 0});
        }
        true;
      `);
    },
    renderRoutePolyline(encodedPolyline) {
      webViewRef.current?.injectJavaScript(`
        if (window.hotplaceMap && window.hotplaceMap.renderRoutePolyline) {
          window.hotplaceMap.renderRoutePolyline(${JSON.stringify(String(encodedPolyline || ''))});
        }
        true;
      `);
    },
    clearRoutePolyline() {
      webViewRef.current?.injectJavaScript(`
        if (window.hotplaceMap && window.hotplaceMap.clearRoutePolyline) {
          window.hotplaceMap.clearRoutePolyline();
        }
        true;
      `);
    },
    selectRouteCircle(x, y, radiusPx) {
      webViewRef.current?.injectJavaScript(`
        if (window.hotplaceMap && window.hotplaceMap.selectRouteCircle) {
          window.hotplaceMap.selectRouteCircle(${Number(x) || 0}, ${Number(y) || 0}, ${Number(radiusPx) || 92});
        }
        true;
      `);
    },
    clearRouteCircle() {
      webViewRef.current?.injectJavaScript(`
        if (window.hotplaceMap && window.hotplaceMap.clearRouteCircle) {
          window.hotplaceMap.clearRouteCircle();
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
            if (payload.type === 'externalPlace') {
              onExternalPlace?.(payload.place);
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
            if (payload.type === 'routeCircleSelected') {
              onRouteCircleSelected?.(payload);
            }
          } catch {
            // Ignore malformed bridge messages.
          }
        }}
      />
    </View>
  );
});

