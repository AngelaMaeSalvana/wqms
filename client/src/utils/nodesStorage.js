const STORAGE_KEY = "wqms_custom_nodes";

// When Supabase is enabled, cache nodes from DB; getNodes() returns this after loadNodes().
let nodesCache = null;

/**
 * Returns the list of nodes: from Supabase cache if Supabase enabled and loaded, else localStorage.
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
 * When Supabase is enabled: fetches nodes from DB, updates cache and localStorage, returns list.
 * When Supabase is disabled: resolves with getNodes() (localStorage).
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
      })) : [];
      nodesCache = list; // always use DB as source of truth (even if empty)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch {
        // ignore
      }
      return nodesCache;
    }
  } catch (e) {
    console.warn("loadNodes from Supabase failed", e);
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
