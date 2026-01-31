const STORAGE_KEY = "wqms_custom_nodes";

export const DEFAULT_NODES = [
  { id: "N-001", name: "River A - Bridge", location: "Villanueva", status: "online", lat: 8.5892, lng: 124.7819 },
  { id: "N-002", name: "River A - Intake", location: "Tagoloan", status: "testing", lat: 8.5411, lng: 124.7522 },
  { id: "N-003", name: "Creek B - Outflow", location: "Cagayan de Oro", status: "offline", lat: 8.4822, lng: 124.6472 },
];

/**
 * Returns the list of nodes from localStorage. If empty or missing, seeds with
 * DEFAULT_NODES and returns that list so all nodes can be edited/deleted.
 */
export function getNodes() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    const parsed = s ? JSON.parse(s) : null;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    const initial = [...DEFAULT_NODES];
    saveNodes(initial);
    return initial;
  } catch {
    return [...DEFAULT_NODES];
  }
}

export function saveNodes(nodes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
  } catch (e) {
    console.warn("Could not save nodes to localStorage", e);
  }
}
