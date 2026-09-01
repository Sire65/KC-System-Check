const CACHE="kc-system-check-v0.3.6";
const APP_PREFIX="kc-system-check-";

async function purgeOldCaches(){
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith(APP_PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));
}

async function networkFirst(request){
  try{
    const response=await fetch(request,{cache:"no-store"});
    if(response&&response.ok){
      const copy=response.clone();
      const cache=await caches.open(CACHE);
      await cache.put(request,copy);
    }
    return response;
  }catch(error){
    const cached=await caches.match(request);
    if(cached)return cached;
    if(request.mode==="navigate")return caches.match("./index.html");
    throw error;
  }
}

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    await purgeOldCaches();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(networkFirst(event.request));
});

self.addEventListener("message",event=>{
  if(event.data?.type==="SKIP_WAITING")self.skipWaiting();
  if(event.data?.type==="PURGE_CACHES")event.waitUntil(purgeOldCaches());
});
