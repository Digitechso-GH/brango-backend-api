async function test() {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyC9fgUh03hZPzLGOv_iJIUd55WVWCkOBKk';
  const query = 'Jr. Libertad 1630, San Miguel 15001, Lima, Peru';
  const res = await fetch(https://maps.googleapis.com/maps/api/geocode/json?address= + encodeURIComponent(query) + &key= + apiKey);
  const data = await res.json();
  console.log('API Response status:', data.status);
  if (data.status === 'OK' && data.results && data.results.length > 0) {
    console.log('Location:', data.results[0].geometry.location);
    console.log('Formatted Address:', data.results[0].formatted_address);
  }
}
test();
