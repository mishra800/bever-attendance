import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables');
}

// Use service-role key so the backend bypasses RLS
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Called on startup — just validates the connection
export async function initializeDatabase(): Promise<void> {
  const { error } = await supabase.from('admin_users').select('id').limit(1);
  if (error) {
    console.error('❌ Supabase connection failed:', error.message);
    throw error;
  }
  console.log('✅ Connected to Supabase');
}

export default supabase;
