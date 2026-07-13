/**
 * src/domain/supabase.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cliente Supabase compartido. Migrado del mismo archivo en Pardos Chicken.
 *
 * Si no hay credenciales configuradas (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
 * el cliente queda en `null` y el resto de la app cae automáticamente a los
 * seeds locales (productsSeed.js / usersSeed.js) + localStorage — el sistema
 * multiagente funciona igual en modo 100% local, sin infraestructura externa,
 * igual que el backend Python original con su mock_data.py.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createClient } from '@supabase/supabase-js'

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {}
const SUPABASE_URL = ENV.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] Sin credenciales — usando datos locales (seeds + localStorage). ' +
    'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env para persistencia real.'
  )
}

export default supabase
