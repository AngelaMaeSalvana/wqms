/**
 * Supabase client for WQMS.
 * Uses REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY (Supabase → Connect → Create React App).
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env';

const supabaseUrl = config.supabase.url;
const supabaseAnonKey = config.supabase.anonKey;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isSupabaseEnabled = () => !!supabase;
