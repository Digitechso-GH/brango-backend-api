const targetText = 'https://www.google.com/maps/place/Tienda+para+Mascotas+%7C+Pikotin,+Jr.+Libertad+1630,+San+Miguel+15001/data=!4m2!3m1!1s0x9105c95f8fa69ba1:0xbde82240ac9d661e!18m1!1e1?utm_source=mstt_1&entry=gps&coh=192189&g_ep=CAESBzI2LjM3LjUYACCenQoqxwEsOTQyNjc3MjcsOTQyOTIxOTUsOTQyOTk1MzIsMTAwNzk2NDk4LDEwMDc5Nzc2MSwxMDA4MjY0NzksMTAwNzk2NTM1LDk0MjgwNTc2LDk0MjA3Mzk0LDk0MjA3NTA2LDk0MjA4NTA2LDk0MjE4NjUzLDk0MjI5ODM5LDEwMDgwODY1NCw5NDI3NTE2OCw5NDI3OTYxOSwxMDA4MzU3MTAsMTAwODI1MDI1LDEwMDgyMDIzNywxMDA4MjI0OTQsMTAwODI3OTc1QgJQRQ%3D%3D&skid=6247006d-34f6-4fb3-99ea-5922b2ea1ac0&g_st=awb';

async function test() {
  const queryToSearch = targetText;
  const searchQuery = queryToSearch.toLowerCase().includes('lima') ? queryToSearch : queryToSearch + ', Lima, Peru';
  
  // Use the env key
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyC9fgUh03hZPzLGOv_iJIUd55WVWCkOBKk'; // From app.json
  
  const res = await fetch(https://maps.googleapis.com/maps/api/geocode/json?address= + encodeURIComponent(searchQuery) + &key= + apiKey);
  const data = await res.json();
  console.log(JSON.stringify(data.results[0]?.geometry?.location));
  console.log(data.results[0]?.formatted_address);
}
test();
