import { Injectable, Logger } from '@nestjs/common';
import { extractAddressFromUrl, resolveGeocodingFromUrl, reverseGeocodeCoords } from '../helpers/geocoding.helper';

export interface GeocodeResult {
  lat: number | null;
  lng: number | null;
  status: string; // 'SUCCESS' | 'FAILED' | 'OVER_QUERY_LIMIT'
  addressText?: string | null;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  extractAddressFromUrl(urlOrAddress: string): string {
    return extractAddressFromUrl(urlOrAddress);
  }

  async resolveGeocodingFromUrl(
    addressText: string,
    inputLat?: number,
    inputLng?: number,
  ): Promise<GeocodeResult> {
    try {
      const res = await resolveGeocodingFromUrl(addressText, inputLat, inputLng);
      return {
        lat: res.lat,
        lng: res.lng,
        status: res.status || 'SUCCESS',
      };
    } catch (err: any) {
      this.logger.error(`Error geocodificando dirección "${addressText}": ${err.message}`);
      return {
        lat: inputLat || null,
        lng: inputLng || null,
        status: 'FAILED',
      };
    }
  }

  async resolveBulkGeocoding(addresses: string[]): Promise<Map<string, GeocodeResult>> {
    const cacheMap = new Map<string, GeocodeResult>();
    const uniqueAddresses = Array.from(new Set(addresses.filter(Boolean)));

    for (const address of uniqueAddresses) {
      const cleanAddress = this.extractAddressFromUrl(address);
      const result = await this.resolveGeocodingFromUrl(cleanAddress);
      cacheMap.set(address, result);
    }

    return cacheMap;
  }

  async reverseGeocodeCoords(lat: number, lng: number): Promise<string | null> {
    try {
      return await reverseGeocodeCoords(lat, lng);
    } catch (err: any) {
      this.logger.error(`Error en reverseGeocodeCoords (${lat}, ${lng}): ${err.message}`);
      return null;
    }
  }
}
