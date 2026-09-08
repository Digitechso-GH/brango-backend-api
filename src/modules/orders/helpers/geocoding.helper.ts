
export function formatEtaRange(totalMinutes: number): string {
  if (totalMinutes <= 10) {
    return '10 a 20 minutos';
  }
  if (totalMinutes < 60) {
    const minMins = Math.max(10, Math.floor(totalMinutes / 5) * 5);
    const maxMins = minMins + 15;
    return `${minMins} a ${maxMins} minutos`;
  }
  
  const minMins = Math.floor(totalMinutes / 5) * 5;
  const maxMins = minMins + 20;
  
  const formatTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (m === 0) return `${h} hora${h > 1 ? 's' : ''}`;
    return `${h} hora${h > 1 ? 's' : ''} y ${m} min`;
  };

  return `${formatTime(minMins)} a ${formatTime(maxMins)}`;
}

import { GeocodingStatus } from '@prisma/client';

export async function resolveGeocodingFromUrl(
  urlOrText: string,
  latManual?: number,
  lngManual?: number,
): Promise<{ lat: number | null; lng: number | null; status: GeocodingStatus }> {
  if (
    latManual !== undefined &&
    lngManual !== undefined &&
    !isNaN(latManual) &&
    !isNaN(lngManual)
  ) {
    return {
      lat: latManual,
      lng: lngManual,
      status: GeocodingStatus.VALIDATED,
    };
  }

  if (!urlOrText || urlOrText.trim() === '') {
    return { lat: null, lng: null, status: GeocodingStatus.FAILED };
  }

  let targetText = urlOrText;

  if (urlOrText.includes('maps.app.goo.gl') || urlOrText.includes('goo.gl/maps')) {
    try {
      const response = await fetch(urlOrText, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      targetText = response.url || urlOrText;
    } catch (err) {
      console.error('Error resolviendo redirección de link corto:', err);
    }
  }

  // Extraer coordenadas con prioridad estricta:
  // 1. Coordenadas exactas del pin del lugar (!3d{lat}!4d{lng})
  // 2. Parámetros de consulta directos (?q=lat,lng o ?ll=lat,lng)
  // 3. Fallback: Posición de cámara del mapa (@lat,lng) - solo si no hay pin explícito
  // 4. Coordenadas en texto plano
  const embeddedMatches = Array.from(targetText.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g));
  const queryMatches = Array.from(targetText.matchAll(/[?&](?:q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/g));
  const atMatches = Array.from(targetText.matchAll(/@(-?\d+\.\d+),(-?\d+\.\d+)/g));
  const directMatches = Array.from(targetText.matchAll(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g));

  const lastMatch = embeddedMatches.pop() || queryMatches.pop() || atMatches.pop() || directMatches.pop();

  if (lastMatch && lastMatch[1] && lastMatch[2]) {
    const lat = parseFloat(lastMatch[1]);
    const lng = parseFloat(lastMatch[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return {
        lat,
        lng,
        status: GeocodingStatus.VALIDATED,
      };
    }
  }

  // 3. Si no hay coordenadas en el texto, usar Google Maps Geocoding API
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (apiKey && !urlOrText.includes('http')) {
    try {
      const searchQuery = targetText.toLowerCase().includes('lima') ? targetText : `${targetText}, Lima, Peru`;
      const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchQuery)}&key=${apiKey}`);
      const data = await res.json();
      if (data.status === "OK" && data.results && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        return {
          lat: location.lat,
          lng: location.lng,
          status: GeocodingStatus.VALIDATED,
        };
      }
    } catch (e) {
      console.error("Error en Google Geocoding API para texto:", e);
    }
  }

  // 4. Si falla todo, retornar null explícito (Sin inventar coordenadas)
  return {
    lat: null,
    lng: null,
    status: GeocodingStatus.FAILED,
  };
}

export function extractAddressFromUrl(url: string): string {
  return url;
}

export function resolveGeocoding(latInput?: number, lngInput?: number) {
  let lat = latInput;
  let lng = lngInput;

  if (lat === undefined || lng === undefined || isNaN(lat) || isNaN(lng)) {
    return { lat: null as any, lng: null as any };
  }

  return { lat, lng };
}

export async function reverseGeocodeCoords(lat: number, lng: number): Promise<string> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`);
      const data = await res.json();
      if (data.status === "OK" && data.results && data.results[0]) {
        return data.results[0].formatted_address;
      }
    } catch (e) {
      console.error("Error en Reverse Geocoding API:", e);
    }
  }

  // Si falla el API o no hay key, devolver un texto genérico o vacío en vez de inventar
  return "Dirección no encontrada (Solo GPS)";
}

export async function calculateRouteETA(originLat: number, originLng: number, destLat: number, destLng: number): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const referer = process.env.PUBLIC_APP_URL || 'http://localhost:3000/';
    const res = await fetch(`https://routes.googleapis.com/directions/v2:computeRoutes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration',
        'Referer': referer,
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: originLat,
              longitude: originLng
            }
          }
        },
        destination: {
          location: {
            latLng: {
              latitude: destLat,
              longitude: destLng
            }
          }
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        languageCode: 'es-PE'
      })
    });

    const data = await res.json();
    if (data.error) {
      console.error(`[Google Routes API Error]: ${data.error.code} - ${data.error.message}`);
      return null;
    }
    if (data.routes && data.routes.length > 0 && data.routes[0].duration) {
      // duration comes as "1500s"
      const seconds = parseInt(data.routes[0].duration.replace('s', ''));
      if (isNaN(seconds)) return null;

      const totalMinutes = Math.round(seconds / 60);
      return formatEtaRange(totalMinutes);
    }
    return null;
  } catch (e) {
    console.error("Error en Compute Routes API:", e);
    return null;
  }
}
