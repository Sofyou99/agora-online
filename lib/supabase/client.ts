import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  // This only warns in the browser console / server logs — it doesn't
  // stop the app from loading, so you can still see the UI even before
  // env vars are configured. Real calls to Supabase will fail until
  // they're set.
  console.warn(
    '[Agora Online] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env.local and fill them in — see SETUP.md.'
  );
}

export const supabase = createClient(url || '', anonKey || '');
