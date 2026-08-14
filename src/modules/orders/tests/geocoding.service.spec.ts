import { Test, TestingModule } from '@nestjs/testing';
import { GeocodingService } from '../services/geocoding.service';

describe('GeocodingService', () => {
  let service: GeocodingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GeocodingService],
    }).compile();

    service = module.get<GeocodingService>(GeocodingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should extract clean address from url', () => {
    const url = 'https://maps.app.goo.gl/3sWXshkfqgfDqwDp8';
    const res = service.extractAddressFromUrl(url);
    expect(typeof res).toBe('string');
  });

  it('should resolve bulk geocoding and return a Map with cached entries', async () => {
    const addresses = ['Av. Argentina 4500, Callao', 'Av. Argentina 4500, Callao', 'Jr. Luna Pizarro 499'];
    const cacheMap = await service.resolveBulkGeocoding(addresses);

    expect(cacheMap).toBeInstanceOf(Map);
    expect(cacheMap.size).toBe(2); // Debería haber 2 entradas únicas en el cache
    expect(cacheMap.has('Av. Argentina 4500, Callao')).toBe(true);
  });
});
