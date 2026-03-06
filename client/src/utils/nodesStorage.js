const STORAGE_KEY = "wqms_custom_nodes";

let nodesCache = null;

/**
 * Returns the list of nodes: from in-memory cache (set by loadNodes) or localStorage.
 * No seed/dummy data. Pages should use initial state [] and set nodes after loadNodes()
 * so Supabase is the source when enabled (no flash of old localStorage).
 */
export function getNodes() {
  if (nodesCache !== null) return nodesCache;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    const parsed = s ? JSON.parse(s) : null;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

/**
 * When Supabase is enabled: fetches nodes from DB, updates cache and localStorage.
 * Always uses Supabase as source when enabled; never falls back to localStorage
 * so that deleted nodes don't reappear from stale cache.
 * Otherwise: resolves with getNodes() (localStorage).
 */
export async function loadNodes() {
  try {
    const { isSupabaseEnabled } = await import('../lib/supabaseClient');
    const { getNodesFromSupabase } = await import('../services/supabaseService');
    if (isSupabaseEnabled()) {
      const fromDb = await getNodesFromSupabase();
      const list = Array.isArray(fromDb) ? fromDb.map((r) => ({
        id: r.id,
        name: r.name,
        location: r.location,
        status: r.status ?? 'offline',
        lat: r.lat,
        lng: r.lng,
        lastMaintenance: r.last_maintenance ?? r.lastMaintenance ?? null,
        active: r.active !== false,
      })) : [];
      nodesCache = list;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch {
        // ignore
      }
      return nodesCache;
    }
  } catch (e) {
    console.warn("loadNodes from Supabase failed", e);
    // When Supabase is enabled, never show stale localStorage—deleted nodes must stay hidden.
    try {
      const { isSupabaseEnabled } = await import('../lib/supabaseClient');
      if (isSupabaseEnabled()) {
        nodesCache = [];
        return [];
      }
    } catch {
      // ignore import errors
    }
  }
  nodesCache = null;
  return getNodes();
}

/**
 * Saves nodes to localStorage and, when Supabase is enabled, to Supabase.
 */
export async function saveNodes(nodes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
  } catch (e) {
    console.warn("Could not save nodes to localStorage", e);
  }
  nodesCache = nodes;
  try {
    const { isSupabaseEnabled } = await import('../lib/supabaseClient');
    const { saveNodesToSupabase } = await import('../services/supabaseService');
    if (isSupabaseEnabled()) await saveNodesToSupabase(nodes);
  } catch (e) {
    console.warn("saveNodes to Supabase failed", e);
  }
}
