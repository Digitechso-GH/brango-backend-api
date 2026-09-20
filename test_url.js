async function test() {
  const url = 'https://maps.app.goo.gl/NuoVYZyBxaaXfYvB9?g_st=awb';
  const res = await fetch(url, { redirect: 'follow' });
  console.log('Redirected URL:', res.url);
  const text = await res.text();
  const match = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  console.log('Title Match:', match ? match[1] : 'No match');
}
test();
