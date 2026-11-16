/* 📒 우리 가족 기록장 — 서비스워커
 * 목적: 폰에서 앱을 다시 열 때 구버전 index.html이 계속 뜨는 문제를 없앤다.
 *  - 앱 본체(HTML)는 항상 "네트워크 우선": 온라인이면 새 파일을 받아 쓰고, 오프라인일 때만 캐시를 쓴다.
 *  - 아이콘·매니페스트 같은 고정 파일만 캐시 우선(뒤에서 조용히 갱신).
 *  - 캐시 이름에 버전을 넣고, 새 버전이 뜨면 옛 캐시는 전부 지운다.
 * 배포할 때 아래 VERSION만 올리면 폰에 쌓인 옛 캐시가 자동으로 정리된다.
 */
const VERSION = 'fh-2026-11-16-4';
const CACHE = VERSION;

self.addEventListener('install', (event) => {
  // 새 서비스워커를 기다리게 하지 않고 바로 활성화한다
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // 클라우드 동기화(mantledb.sh) 등 다른 주소는 서비스워커가 손대지 않는다
  if (url.origin !== self.location.origin) return;

  const isAppShell =
    req.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html');

  if (isAppShell) {
    // 네트워크 우선 — 온라인이면 무조건 최신본, 실패했을 때만 저장해 둔 사본
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          const c = await caches.open(CACHE);
          c.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (err) {
        const c = await caches.open(CACHE);
        const hit = (await c.match(req)) ||
          (await c.match(url.origin + url.pathname)) ||
          (await c.match('./index.html')) ||
          (await c.match('./'));
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  // 그 외 고정 파일: 캐시 우선 + 뒤에서 갱신
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) c.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    if (hit) { event.waitUntil(network); return hit; }
    const res = await network;
    return res || Response.error();
  })());
});
