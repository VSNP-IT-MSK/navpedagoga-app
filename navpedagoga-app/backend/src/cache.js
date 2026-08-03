/**
 * Простое in-memory кэширование с TTL. Без внешней инфраструктуры (Redis и
 * т.п.) — специально, чтобы весь стек оставался бесплатным и не требовал
 * дополнительного сервиса. Достаточно для одного инстанса бэкенда на
 * бесплатном тарифе Render.
 *
 * Если проект вырастет до нескольких инстансов backend (нужно шарить кэш
 * между ними) — самый простой бесплатный апгрейд: Upstash Redis (есть
 * бесплатный тариф с REST API, не требует постоянного соединения) вместо
 * этого модуля, с тем же интерфейсом get/set/invalidate.
 */
const store = new Map(); // key -> { value, expiresAt }

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs = 30_000) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Invalidates one key, or every key starting with `prefix` when prefix is given. */
export function cacheInvalidate(prefix) {
  if (!prefix) return;
  for (const key of store.keys()) {
    if (key === prefix || key.startsWith(prefix)) store.delete(key);
  }
}

/** Wraps an async loader with cache-aside: returns cached value or loads, caches, and returns it. */
export async function cached(key, ttlMs, loader) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  cacheSet(key, value, ttlMs);
  return value;
}
