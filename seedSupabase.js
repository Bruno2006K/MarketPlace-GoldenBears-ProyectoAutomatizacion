/**
 * seedSupabase.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Puebla las tablas `productos` y `usuarios` de Supabase con los datos de
 * data/seeds/*. Ejecutar con: npm run seed
 * Requiere VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env (o SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY si prefieres usar la service role para el seed).
 *
 * Si además hay GEMINI_API_KEY configurada, genera el embedding (RAG /
 * pgvector, ver guia_automatizacion.md 5.2) de cada producto antes de
 * insertarlo, para que SearchAgent pueda hacer búsqueda vectorial real. Sin
 * esa key, se omite (los productos quedan sin `embedding` y SearchAgent cae
 * automáticamente a búsqueda por texto — ver src/agents/SearchAgent.js).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { PRODUCTS_SEED } from './src/data/seeds/productsSeed.js'
import { USERS_SEED } from './src/data/seeds/usersSeed.js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
const geminiKey = process.env.GEMINI_API_KEY

if (!url || !key) {
  console.error('❌ Falta configurar VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env')
  process.exit(1)
}

const supabase = createClient(url, key)

const GEMINI_EMBED_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'

async function embeddingDeProducto(producto) {
  const texto = `${producto.nombre}. Categoría: ${producto.categoria}. Marca: ${producto.marca}. ${producto.descripcion || ''} Tags: ${(producto.tags || []).join(', ')}`
  const res = await fetch(`${GEMINI_EMBED_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text: texto }] },
      embedContentConfig: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 },
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`)
  return body.embedding?.values || null
}

async function conEmbeddings(productos) {
  if (!geminiKey) {
    console.log('ℹ️  GEMINI_API_KEY no configurada — se omiten embeddings (SearchAgent usará búsqueda por texto).')
    return productos
  }
  console.log('🔎 Generando embeddings (Gemini gemini-embedding-001) para RAG/pgvector...')
  const resultado = []
  for (const producto of productos) {
    try {
      const embedding = await embeddingDeProducto(producto)
      resultado.push({ ...producto, embedding })
      process.stdout.write('.')
    } catch (err) {
      console.warn(`\n⚠️  No se pudo generar embedding de ${producto.id}: ${err.message}`)
      resultado.push(producto)
    }
  }
  console.log('\n')
  return resultado
}

async function seed() {
  console.log('🐻 Poblando Supabase — Marketplace Golden Bears\n')

  const productosConEmbeddings = await conEmbeddings(PRODUCTS_SEED)

  const { error: prodError } = await supabase.from('productos').upsert(productosConEmbeddings, { onConflict: 'id' })
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
