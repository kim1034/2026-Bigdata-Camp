import { useEffect, useRef } from "react";
import { Place, CategoryType } from "../types";

// Get Leaflet from window (loaded via CDN in index.html)
declare const L: any;

interface MapProps {
  places: Place[];
  selectedPlace: Place | null;
  onSelectPlace: (place: Place) => void;
  onMapClick?: () => void;
  circleCenter?: [number, number] | null;
  circleRadius?: number;
  onMapClickCoords?: (lat: number, lng: number) => void;
  routePlaces?: Place[];
}

// Map category to color and SVG icon path
const getCategoryStyles = (category: CategoryType) => {
  switch (category) {
    case "카페":
      return {
        bgClass: "bg-sky-500",
        borderClass: "border-sky-600",
        iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>`
      };
    case "식당":
      return {
        bgClass: "bg-blue-500",
        borderClass: "border-blue-600",
        iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`
      };
    case "펜션/숙소":
      return {
        bgClass: "bg-indigo-500",
        borderClass: "border-indigo-600",
        iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3"/><path d="M19 17V11a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M5 14h14"/><path d="M12 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/></svg>`
      };
    case "관광지/기타":
    default:
      return {
        bgClass: "bg-slate-700",
        borderClass: "border-slate-800",
        iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.886H3.82l5.117 3.718L7 18.5 12 14.75l5 3.75-1.938-5.896 5.117-3.718h-6.268Z"/></svg>`
      };
  }
};

export default function Map({ 
  places, 
  selectedPlace, 
  onSelectPlace, 
  onMapClick,
  circleCenter,
  circleRadius = 800,
  onMapClickCoords,
  routePlaces = []
}: MapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<{ [key: string]: any }>({});
  const circleLayerRef = useRef<any>(null);
  const polylineLayerRef = useRef<any>(null);

  // Keep callback refs fresh to avoid stale closures in Leaflet events
  const onMapClickCoordsRef = useRef(onMapClickCoords);
  const onMapClickRef = useRef(onMapClick);
  const onSelectPlaceRef = useRef(onSelectPlace);

  useEffect(() => {
    onMapClickCoordsRef.current = onMapClickCoords;
    onMapClickRef.current = onMapClick;
    onSelectPlaceRef.current = onSelectPlace;
  }, [onMapClickCoords, onMapClick, onSelectPlace]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Check if Leaflet L exists
    const L_Library = (window as any).L;
    if (!L_Library) {
      console.warn("Leaflet library is not loaded from CDN.");
      return;
    }

    // Default center in Seoul (Sungsu-dong region coordinates)
    const initialLat = 37.5446;
    const initialLng = 127.0559;

    // Check if map container is already initialized or has lingering leaflet properties
    if (mapContainerRef.current) {
      const container = mapContainerRef.current as any;
      if (container._leaflet_id !== undefined) {
        container._leaflet_id = null;
      }
    }

    // Initialize map with a robust fallback
    try {
      mapRef.current = L_Library.map(mapContainerRef.current, {
        zoomControl: false, 
        attributionControl: false
      }).setView([initialLat, initialLng], 14);
    } catch (err) {
      console.warn("Leaflet map initialization warning: container might have been active. Retrying with empty container...", err);
      if (mapContainerRef.current) {
        mapContainerRef.current.innerHTML = "";
        const container = mapContainerRef.current as any;
        container._leaflet_id = null;
      }
      try {
        mapRef.current = L_Library.map(mapContainerRef.current, {
          zoomControl: false, 
          attributionControl: false
        }).setView([initialLat, initialLng], 14);
      } catch (retryErr) {
        console.error("Critical error: Failed to initialize Leaflet map container after reset", retryErr);
        return;
      }
    }

    // Standard OpenStreetMap Tile Layer (modern, voyager tiles)
    L_Library.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
    }).addTo(mapRef.current);

    // Add zoom control at bottom right
    L_Library.control.zoom({
      position: "bottomright"
    }).addTo(mapRef.current);

    // Capture map clicks for either full coordinate click or background dismiss
    mapRef.current.on("click", (e: any) => {
      if (onMapClickCoordsRef.current) {
        onMapClickCoordsRef.current(e.latlng.lat, e.latlng.lng);
      }
      
      const target = e.originalEvent?.target;
      if (target) {
        const classList = target.classList;
        const tagName = target.tagName ? target.tagName.toLowerCase() : "";
        const isContainer = classList && typeof classList.contains === "function" && classList.contains("leaflet-container");
        const isPath = tagName === "path";
        const isTile = classList && typeof classList.contains === "function" && classList.contains("leaflet-tile");
        
        if (isContainer || isPath || isTile) {
          if (onMapClickRef.current) onMapClickRef.current();
        }
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Sync place markers with places array
  useEffect(() => {
    const L_Library = (window as any).L;
    if (!mapRef.current || !L_Library) return;

    // Remove old markers
    Object.keys(markersRef.current).forEach((id) => {
      mapRef.current.removeLayer(markersRef.current[id]);
    });
    markersRef.current = {};

    // Add new markers
    places.forEach((place) => {
      const styles = getCategoryStyles(place.category);
      const isSelected = selectedPlace?.id === place.id;
      
      // Check if place is part of route sequence
      const routeIndex = routePlaces ? routePlaces.findIndex((rp) => rp.id === place.id) : -1;
      const isRouting = routeIndex !== -1;
      
      const markerHtml = `
        <div class="relative group">
          <!-- Active pulse effect if selected -->
          ${isSelected ? `<span class="animate-ping absolute inline-flex h-10 w-10 rounded-full ${styles.bgClass} opacity-40"></span>` : ''}
          <div class="flex items-center justify-center w-10 h-10 rounded-full border-2 border-white shadow-lg ${styles.bgClass} text-white transform hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer ${isSelected ? 'scale-115 ring-4 ring-offset-2 ring-[#0064FF] shadow-xl' : 'scale-100'}">
            ${styles.iconSvg}
            
            <!-- Visitation route order bubble if routing active -->
            ${isRouting ? `
              <div class="absolute -top-2.5 -right-2.5 w-5 h-5 bg-black text-white text-[10px] font-black rounded-full border border-white flex items-center justify-center shadow-md animate-bounce">
                ${routeIndex + 1}
              </div>
            ` : ''}
          </div>
          <div class="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 font-medium z-50">
            ${place.name}
          </div>
        </div>
      `;

      const customIcon = L_Library.divIcon({
        html: markerHtml,
        className: "custom-pin-marker",
        iconSize: [40, 40],
        iconAnchor: [20, 20] 
      });

      const marker = L_Library.marker([place.latitude, place.longitude], { icon: customIcon })
        .addTo(mapRef.current)
        .on("click", () => {
          onSelectPlaceRef.current(place);
        });

      markersRef.current[place.id] = marker;
    });

    // Auto-fit bounds if we have pins, and not selecting specific place
    if (places.length > 0 && !selectedPlace && !circleCenter) {
      const group = L_Library.featureGroup(Object.values(markersRef.current));
      mapRef.current.fitBounds(group.getBounds().pad(0.15), { maxZoom: 16 });
    }
  }, [places, selectedPlace, routePlaces, circleCenter]);

  // Handle selected place centering
  useEffect(() => {
    if (!mapRef.current || !selectedPlace) return;
    mapRef.current.setView([selectedPlace.latitude, selectedPlace.longitude], 16, {
      animate: true,
      duration: 0.6
    });
  }, [selectedPlace]);

  // Sync Circle and Polyline route overlay
  useEffect(() => {
    const L_Library = (window as any).L;
    if (!mapRef.current || !L_Library) return;

    // 1. Draw/Remove Circle
    if (circleLayerRef.current) {
      mapRef.current.removeLayer(circleLayerRef.current);
      circleLayerRef.current = null;
    }

    if (circleCenter) {
      circleLayerRef.current = L_Library.circle(circleCenter, {
        color: "#0064FF",
        fillColor: "#0064FF",
        fillOpacity: 0.12,
        radius: circleRadius,
        weight: 1.5,
        dashArray: "4, 4"
      }).addTo(mapRef.current);

      // Pan to circle center smoothly
      mapRef.current.setView(circleCenter, 14, { animate: true });
    }

    // 2. Draw/Remove Polyline route line
    if (polylineLayerRef.current) {
      mapRef.current.removeLayer(polylineLayerRef.current);
      polylineLayerRef.current = null;
    }

    if (routePlaces && routePlaces.length >= 2) {
      const latlngs = routePlaces.map((p) => [p.latitude, p.longitude]);
      polylineLayerRef.current = L_Library.polyline(latlngs, {
        color: "#0064FF",
        weight: 3.5,
        opacity: 0.85,
        dashArray: "6, 6",
        lineJoin: "round"
      }).addTo(mapRef.current);
    }
  }, [circleCenter, circleRadius, routePlaces]);

  return (
    <div className="relative w-full h-full">
      {/* Map Element */}
      <div id="capture-map" ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Styled Grid Backdrop or watermark for the map */}
      <div className="absolute top-4 left-4 z-20 pointer-events-none bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-200 shadow-sm flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span className="text-xs font-semibold text-slate-700">
          {circleCenter ? "동선 구역 편집 모드" : "실시간 지도 모드"}
        </span>
      </div>
    </div>
  );
}
