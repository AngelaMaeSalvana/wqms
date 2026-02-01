/**
 * App config from .env (Create React App loads REACT_APP_* at build/start).
 * Single source: set values in .env or Vercel Environment Variables.
 */
const env = typeof process !== 'undefined' && process.env ? process.env : {};

export const config = {
  // MQTT (HiveMQ Cloud) — use wss:// for HTTPS/Vercel
  mqtt: {
    url: env.REACT_APP_MQTT_WS_URL || env.REACT_APP_MQTT_URL || '',
    user: env.REACT_APP_MQTT_USER || '',
    pass: env.REACT_APP_MQTT_PASS || '',
  },
  // Supabase — use Supabase’s CRA recommendation (REACT_APP_*); fallbacks for older names
  supabase: {
    url: env.REACT_APP_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey:
      env.REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      env.REACT_APP_SUPABASE_ANON_KEY ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      '',
  },
  // Backend API (optional)
  apiUrl: env.REACT_APP_API_URL || '',
};

export default config;
