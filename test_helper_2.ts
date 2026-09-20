import { resolveGeocodingFromUrl } from './src/modules/orders/helpers/geocoding.helper';

// Redefinir la funcion para poner logs
export async function testGeocoding(urlOrText) {
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
      console.log('Redirect URL:', targetText);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  let extractedPlaceName = '';

  if (targetText.includes('google.com/maps') || targetText.includes('maps.app.goo.gl')) {
    try {
      const htmlRes = await fetch(targetText, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      });
      const htmlText = await htmlRes.text();

      // B. Intentar extraer del pathname
      const placeMatch = targetText.match(/\/place\/([^\/]+)/);
      if (placeMatch && placeMatch[1]) {
        extractedPlaceName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
        console.log('placeMatch extracted:', extractedPlaceName);
      }

      // C. Si aún no hay nombre, extraer del <meta property="og:title">
      if (!extractedPlaceName) {
        const titleMatch = htmlText.match(/<meta\s+property=\"og:title\"\s+content=\"([^\"]+)\"/i);
        if (titleMatch && titleMatch[1]) {
          const fullTitle = titleMatch[1];
          if (!fullTitle.toLowerCase().includes('google maps')) {
            extractedPlaceName = fullTitle.split('·')[0].trim();
          }
        }
      }
    } catch (e) { }
  }

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyC9fgUh03hZPzLGOv_iJIUd55WVWCkOBKk';
  if (apiKey) {
    let queryToSearch = '';
    
    if (extractedPlaceName) {
      queryToSearch = extractedPlaceName;
    } else if (!urlOrText.includes('http')) {
      queryToSearch = targetText;
    }

    console.log('queryToSearch:', queryToSearch);

    if (queryToSearch) {
      try {
        const searchQuery = queryToSearch.toLowerCase().includes('lima') ? queryToSearch : queryToSearch + ', Lima, Peru';
        console.log('Search Query to Geocoding API:', searchQuery);
        const res = await fetch(https://maps.googleapis.com/maps/api/geocode/json?address= + encodeURIComponent(searchQuery) + &key= + apiKey);
        const data = await res.json();
        console.log('API Response status:', data.status);
        if (data.status === "OK" && data.results && data.results.length > 0) {
          console.log('Location:', data.results[0].geometry.location);
          console.log('Formatted Address:', data.results[0].formatted_address);
        }
      } catch (e) {
      }
    }
  }
}

testGeocoding('https://maps.app.goo.gl/NuoVYZyBxaaXfYvB9?g_st=awb');
