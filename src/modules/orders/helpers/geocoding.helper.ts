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

  let targetText = urlOrText.trim();

  // 1. Si es link corto de Google Maps (maps.app.goo.gl o goo.gl/maps), resolver redirección
  if (targetText.includes('maps.app.goo.gl') || targetText.includes('goo.gl/maps')) {
    try {
      const response = await fetch(targetText, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      targetText = response.url || targetText;
    } catch (err) {
      console.error('Error resolviendo redirección de link corto:', err);
    }
  }

  // 2. Extraer coordenadas directas presentes en la URL
  // Formatos comunes:
  // - !3d{lat}!4d{lng} (pin exacto del lugar)
  // - @{lat},{lng} (cámara / viewport)
  // - ?q={lat},{lng} o ?ll={lat},{lng}
  // - {lat},{lng} en texto plano
  const embeddedMatches = Array.from(targetText.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g));
  const atMatches = Array.from(targetText.matchAll(/@(-?\d+\.\d+),(-?\d+\.\d+)/g));
  const queryMatches = Array.from(targetText.matchAll(/[?&](?:q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/g));
  const directMatches = Array.from(targetText.matchAll(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g));

  const coordMatch = embeddedMatches.pop() || atMatches.pop() || queryMatches.pop() || directMatches.pop();

  if (coordMatch && coordMatch[1] && coordMatch[2]) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return {
        lat,
        lng,
        status: GeocodingStatus.VALIDATED,
      };
    }
  }

  // 3. Si la URL no contiene coordenadas numéricas directas (ej: URLs tipo /place/...):
  // Extraer el nombre o dirección desde el pathname de la URL
  let extractedAddress = '';
  const placeMatch = targetText.match(/\/place\/([^\/]+)/);
  if (placeMatch && placeMatch[1]) {
    const decodedPlace = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
    // En URLs como /place/Tienda+para+Mascotas+%7C+Pikotin,+Jr.+Libertad+1630,+San+Miguel+15001
    // Google Geocoding API falla si se le pasa el nombre del negocio junto con la dirección.
    // Si contiene comas, separamos y enviamos la dirección limpia (calle + distrito).
    if (decodedPlace.includes(',')) {
      const parts = decodedPlace.split(',');
      parts.shift(); // Descartar el nombre del negocio
      extractedAddress = parts.join(',').trim();
    } else {
      extractedAddress = decodedPlace.trim();
    }
  }

  // 4. Geocoding API de Google Maps
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  let queryToSearch = '';

  if (extractedAddress) {
    queryToSearch = extractedAddress;
  } else if (!urlOrText.includes('http')) {
    queryToSearch = targetText;
  }

  if (apiKey && queryToSearch) {
    try {
      const searchQuery = queryToSearch.toLowerCase().includes('lima')
        ? queryToSearch
        : `${queryToSearch}, Lima, Peru`;

      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchQuery)}&key=${apiKey}`,
      );
      const data = await res.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        return {
          lat: location.lat,
          lng: location.lng,
          status: GeocodingStatus.VALIDATED,
        };
      } else {
        console.error(`[Geocoding API] No se encontraron resultados para "${searchQuery}". Status: ${data.status}`);
      }
    } catch (e) {
      console.error('Error en Google Geocoding API:', e);
    }
  }

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