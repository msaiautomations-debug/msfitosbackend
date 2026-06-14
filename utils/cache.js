const cache = {};

/**
 * Get item from cache
 * @param {string} key 
 * @returns {any|null}
 */
function get(key) {
  const item = cache[key];
  if (!item) return null;
  if (Date.now() > item.expiry) {
    delete cache[key];
    return null;
  }
  return item.value;
}

/**
 * Set item in cache
 * @param {string} key 
 * @param {any} value 
 * @param {number} ttlSeconds 
 */
function set(key, value, ttlSeconds = 300) {
  cache[key] = {
    value,
    expiry: Date.now() + (ttlSeconds * 1000),
  };
}

/**
 * Delete item from cache
 * @param {string} key 
 */
function del(key) {
  delete cache[key];
}

/**
 * Flush all items from cache
 */
function flushAll() {
  for (const key in cache) {
    delete cache[key];
  }
}

/**
 * Invalidate all keys starting with a specific prefix
 * @param {string} prefix 
 */
function invalidateByPrefix(prefix) {
  for (const key in cache) {
    if (key.startsWith(prefix)) {
      delete cache[key];
    }
  }
}

module.exports = {
  get,
  set,
  del,
  flushAll,
  invalidateByPrefix,
};
