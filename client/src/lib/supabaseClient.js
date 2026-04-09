/**
 * Supabase client for WQMS.
 * Reads URL and anon key from REACT_APP_* (CRA) or NEXT_PUBLIC_* (Next/Vercel) env vars.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isSupabaseEnabled = () => !!supabase;

if (supabase) {
  console.log('WQMS: Supabase enabled — client will use Supabase for nodes, readings, and summaries.');
} else if (typeof window !== 'undefined') {
  const missing = [];
  if (!supabaseUrl) missing.push('REACT_APP_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('REACT_APP_SUPABASE_ANON_KEY');
  console.warn(
    'WQMS: Supabase disabled — nodes use localStorage (empty on new devices), data uses backend API. ' +
    'Set in Vercel: ' + (missing.length ? missing.join(', ') : 'REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY')
  );
}
