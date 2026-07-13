/**
 * seedSupabase.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Puebla las tablas `productos` y `usuarios` de Supabase con los datos de
 * data/seeds/*. Ejecutar con: npm run seed
 * Requiere VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env (o SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY si prefieres usar la service role para el seed).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { PRODUCTS_SEED } from './src/data/seeds/productsSeed.js'
import { USERS_SEED } from './src/data/seeds/usersSeed.js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('❌ Falta configurar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env')
  process.exit(1)
}

const supabase = createClient(url, key)

async function seed() {
  console.log('🐻 Poblando Supabase — Marketplace Golden Bears\n')

  const { error: prodError } = await supabase.from('productos').upsert(PRODUCTS_SEED, { onConflict: 'id' })
  if (prodError) {
    console.error('❌ Error insertando productos:', prodError.message)
  } else {
    console.log(`✅ ${PRODUCTS_SEED.length} productos insertados/actualizados`)
  }

  const { error: userError } = await supabase.from('usuarios').upsert(USERS_SEED, { onConflict: 'id' })
  if (userError) {
    console.error('❌ Error insertando usuarios:', userError.message)
  } else {
    console.log(`✅ ${USERS_SEED.length} usuarios insertados/actualizados`)
  }

  console.log('\nListo. Ejecuta `npm run dev` para ver el catálogo cargado desde Supabase.')
}

seed()
