const fs = require('fs');
async function test() {
  const url = 'https://maps.app.goo.gl/NuoVYZyBxaaXfYvB9?g_st=awb';
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  fs.writeFileSync('map_html.txt', text);
  console.log('Saved to map_html.txt');
}
test();
