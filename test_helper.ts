import { resolveGeocodingFromUrl } from './src/modules/orders/helpers/geocoding.helper';

async function main() {
  const url = 'https://maps.app.goo.gl/NuoVYZyBxaaXfYvB9?g_st=awb';
  console.log('Testing url:', url);
  const result = await resolveGeocodingFromUrl(url);
  console.log('Result:', result);
}
main();
