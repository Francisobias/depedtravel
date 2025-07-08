const graphCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function setCache(key, value) {
  graphCache.set(key, { value, expiry: Date.now() + CACHE_TTL });
}

function getCache(key) {
  const cached = graphCache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value;
  graphCache.delete(key);
  return null;
}

function invalidateCache(key) {
  graphCache.delete(key);
  if (key === '/employees' || key === '/travels') graphCache.delete('/travels');
}

module.exports = { setCache, getCache, invalidateCache };