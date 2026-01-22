/**
 * CacheUtil.js - Shared localStorage caching utility for TTMS
 * Provides cached fetch functionality to improve page load performance
 */

const CacheUtil = (function () {
    // Cache key prefix
    const CACHE_PREFIX = 'TTMS_cache_';

    // Memory cache for even faster access (resists localStorage overhead within same session)
    const memoryCache = new Map();

    // In-flight request dedupe (avoid N identical network calls at once)
    const inflight = new Map();

    // TTL (Time-To-Live) in milliseconds for different entity types
    const TTL_CONFIG = {
        'sesisemester': 24 * 60 * 60 * 1000,      // 24 hours - rarely changes
        'pelajar_subjek': 60 * 60 * 1000,          // 1 hour - student's subjects
        'jadual_subjek': 60 * 60 * 1000,           // 1 hour - timetable data
        'jadual_ruang': 60 * 60 * 1000,            // 1 hour - room schedule
        'ruang': 6 * 60 * 60 * 1000,               // 6 hours - room list
        'subjek': 60 * 60 * 1000,                  // 1 hour - course list
        'subjek_seksyen': 60 * 60 * 1000,          // 1 hour - course sections
        'pensyarah': 6 * 60 * 60 * 1000,           // 6 hours - lecturer list
        'pelajar': 30 * 60 * 1000,                 // 30 minutes - student list
        'subjek_pelajar': 30 * 60 * 1000,          // 30 minutes - students per subject
        'default': 30 * 60 * 1000                  // 30 minutes - default TTL
    };

    // Statistics tracking
    let stats = {
        hits: 0,
        misses: 0
    };

    // Circuit breaker for full storage
    let storageQuotaExceeded = false;

    /**
     * Extract entity type from URL for TTL determination
     * @param {string} url - The API URL
     * @returns {string} - The entity type
     */
    function getEntityFromUrl(url) {
        const match = url.match(/entity=([^&]+)/);
        return match ? match[1] : 'default';
    }

    /**
     * Get TTL for a given entity type
     * @param {string} entity - The entity type
     * @returns {number} - TTL in milliseconds
     */
    function getTTL(entity) {
        return TTL_CONFIG[entity] || TTL_CONFIG['default'];
    }

    /**
     * Generate cache key from URL
     * @param {string} url - The API URL
     * @returns {string} - Cache key
     */
    function getCacheKey(url) {
        // Use a simple hash function to keep keys manageable but unique
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return CACHE_PREFIX + hash + '_' + btoa(url.substring(0, 100)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 40);
    }

    /**
     * Check if cached data is still valid
     * @param {object} cacheEntry - The cached entry with timestamp and data
     * @param {number} ttl - Time-to-live in milliseconds
     * @returns {boolean} - True if cache is valid
     */
    function isCacheValid(cacheEntry, ttl) {
        if (!cacheEntry || !cacheEntry.timestamp) return false;
        const age = Date.now() - cacheEntry.timestamp;
        return age < ttl;
    }

    /**
     * Cached fetch - checks cache before making network request
     * @param {string} url - The URL to fetch
     * @param {object} options - Optional fetch options and cache settings
     * @returns {Promise} - Promise resolving to JSON data
     */
    async function cachedFetch(url, options = {}) {
        const {
            forceRefresh = false,    // Force network fetch
            skipCache = false,       // Don't use or store cache
            customTTL = null,        // Override default TTL
            staleWhileRevalidate = false // If cache is stale, return it immediately and refresh in background
        } = options;

        // If skipCache, just do normal fetch
        if (skipCache) {
            const response = await fetch(url);
            return response.json();
        }

        const cacheKey = getCacheKey(url);
        const entity = getEntityFromUrl(url);
        const ttl = customTTL || getTTL(entity);

        // If we already have an identical request in-flight, reuse it
        // (unless forceRefresh or skipCache, which intentionally bypass normal behavior)
        if (!skipCache && !forceRefresh && inflight.has(cacheKey)) {
            return inflight.get(cacheKey);
        }

        // Try to get from cache first (unless forceRefresh)
        if (!forceRefresh) {
            // 1. Check memory cache first (instant)
            if (memoryCache.has(cacheKey)) {
                const memoryEntry = memoryCache.get(cacheKey);
                if (isCacheValid(memoryEntry, ttl)) {
                    stats.hits++;
                    return memoryEntry.data;
                }
            }

            // 2. Check localStorage
            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const cacheEntry = JSON.parse(cached);
                    if (isCacheValid(cacheEntry, ttl)) {
                        stats.hits++;
                        // Put in memory cache for next time
                        memoryCache.set(cacheKey, cacheEntry);

                        if (stats.hits % 20 === 0) {
                            console.debug(`📦 Cache HIT: ${entity} and others...`);
                        }
                        return cacheEntry.data;
                    }

                    // Stale-while-revalidate: serve stale immediately, refresh in background
                    if (staleWhileRevalidate && cacheEntry && cacheEntry.data) {
                        stats.hits++;
                        // Kick off background refresh (deduped)
                        if (!inflight.has(cacheKey)) {
                            const refreshPromise = (async () => {
                                try {
                                    const response = await fetch(url);
                                    const text = await response.text();
                                    const data = JSON.parse(text);
                                    const newEntry = { timestamp: Date.now(), data };
                                    memoryCache.set(cacheKey, newEntry);
                                    try { localStorage.setItem(cacheKey, JSON.stringify(newEntry)); } catch (e) { /* ignore */ }
                                    return data;
                                } catch (e) {
                                    return cacheEntry.data;
                                } finally {
                                    inflight.delete(cacheKey);
                                }
                            })();
                            inflight.set(cacheKey, refreshPromise);
                        }
                        return cacheEntry.data;
                    }
                }
            } catch (e) {
                console.warn('Cache read error:', e);
            }
        }

        // Cache miss or expired - fetch from network
        stats.misses++;
        console.debug(`🌐 Cache MISS: ${entity} - Fetching from network...`);

        try {
            const fetchPromise = (async () => {
                const response = await fetch(url);
                const text = await response.text();

                let data;
                try {
                    data = JSON.parse(text);
                } catch (parseError) {
                    console.error(`❌ Failed to parse JSON from ${url}:`, text.substring(0, 200));
                    // If it's not JSON, we might want to return the raw text or throw
                    // For TTMS, most entities should be JSON.
                    throw new Error("Invalid JSON response from TTMS");
                }

                // Store in cache
                const cacheEntry = {
                    timestamp: Date.now(),
                    data: data
                };

                // Store in memory cache
                memoryCache.set(cacheKey, cacheEntry);

                // Store in localStorage (if quota not exceeded)
                if (!storageQuotaExceeded) {
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
                    } catch (e) {
                        if (e.name === 'QuotaExceededError' || e.code === 22) {
                            // localStorage is full - try to clear old entries
                            console.warn('Cache write error (Quota Exceeded), clearing old entries...');
                            const cleared = clearOldCache();

                            // If we couldn't clear anything or it's still full, give up for this session
                            try {
                                localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
                            } catch (e2) {
                                console.warn('Cache write still failed after cleanup. Disabling persistent cache for this session to improve performance.');
                                storageQuotaExceeded = true;
                            }
                        } else {
                            console.warn('Cache write error:', e);
                        }
                    }
                }

                return data;
            })();

            // Dedupe in-flight for this cache key (unless skipCache/forceRefresh)
            if (!skipCache && !forceRefresh) {
                inflight.set(cacheKey, fetchPromise);
            }

            const data = await fetchPromise;
            return data;
        } catch (error) {
            console.error('Fetch error:', error);

            // On network error, try to return stale cache if available
            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const cacheEntry = JSON.parse(cached);
                    console.warn('Returning stale cache due to network error');
                    return cacheEntry.data;
                }
            } catch (e) {
                // No cache available
            }

            throw error;
        } finally {
            inflight.delete(cacheKey);
        }
    }

    /**
     * Prefetch a URL into cache (best-effort).
     * @param {string} url
     * @param {object} options
     * @returns {Promise<void>}
     */
    async function prefetch(url, options = {}) {
        try {
            await cachedFetch(url, { ...options, staleWhileRevalidate: true });
        } catch (e) {
            // best effort
        }
    }

    /**
     * Clear cache entries by prefix or all TTMS cache
     * @param {string} entityPrefix - Optional entity prefix to clear
     */
    function clearCache(entityPrefix = null) {
        const keysToRemove = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                if (!entityPrefix) {
                    keysToRemove.push(key);
                } else {
                    // Check if this cache entry is for the specified entity
                    try {
                        const entry = JSON.parse(localStorage.getItem(key));
                        // Since we encode the URL, we can't easily filter by entity
                        // So if entityPrefix is specified, clear all for now
                        keysToRemove.push(key);
                    } catch (e) {
                        keysToRemove.push(key);
                    }
                }
            }
        }

        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log(`🗑️ Cleared ${keysToRemove.length} cache entries`);
        return keysToRemove.length;
    }

    /**
     * Clear old/expired cache entries to free up space
     */
    function clearOldCache() {
        const now = Date.now();
        const keysToRemove = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                try {
                    const entry = JSON.parse(localStorage.getItem(key));
                    // Remove entries older than 24 hours
                    if (now - entry.timestamp > 24 * 60 * 60 * 1000) {
                        keysToRemove.push(key);
                    }
                } catch (e) {
                    keysToRemove.push(key);
                }
            }
        }

        keysToRemove.forEach(key => localStorage.removeItem(key));
        return keysToRemove.length;
    }

    /**
     * Get cache statistics
     * @returns {object} - Cache hit/miss stats
     */
    function getStats() {
        const hitRate = stats.hits + stats.misses > 0
            ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1)
            : 0;
        return {
            hits: stats.hits,
            misses: stats.misses,
            hitRate: hitRate + '%'
        };
    }

    /**
     * Reset statistics
     */
    function resetStats() {
        stats.hits = 0;
        stats.misses = 0;
    }

    /**
     * Get all cache entries info (for debugging)
     * @returns {array} - Array of cache entry info
     */
    function getCacheInfo() {
        const entries = [];
        const now = Date.now();

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CACHE_PREFIX)) {
                try {
                    const entry = JSON.parse(localStorage.getItem(key));
                    entries.push({
                        key: key.substring(CACHE_PREFIX.length),
                        age: Math.round((now - entry.timestamp) / 1000) + 's',
                        size: localStorage.getItem(key).length + ' bytes'
                    });
                } catch (e) {
                    entries.push({ key: key, error: 'parse error' });
                }
            }
        }

        return entries;
    }

    // Public API
    return {
        fetch: cachedFetch,
        clearCache: clearCache,
        clearOldCache: clearOldCache,
        getStats: getStats,
        resetStats: resetStats,
        getCacheInfo: getCacheInfo,
        // Expose for direct fetch replacement
        cachedFetch: cachedFetch,
        prefetch: prefetch
    };
})();

// For backward compatibility - allow using CacheUtil.fetch() or just cachedFetch()
if (typeof window !== 'undefined') {
    window.CacheUtil = CacheUtil;
    window.cachedFetch = CacheUtil.cachedFetch;
}
