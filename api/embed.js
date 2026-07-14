/**
 * api/embed.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxy serverless hacia el modelo de embeddings de Gemini
 * (gemini-embedding-001), usado para la búsqueda vectorial RAG del
 * SearchAgent/ConciergeAgent contra pgvector en Supabase (ver
 * guia_automatizacion.md, sección 5.2) y por seedSupabase.js para indexar
 * el catálogo. La API key vive solo en el servidor (GEMINI_API_KEY).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { aplicarGuard } from './_guard.js'

const GEMINI_EMBED_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'
// 768 dimensiones: balance entre calidad semántica y tamaño de índice ivfflat.
const OUTPUT_DIMENSIONALITY = 768
const MAX_TEXT_CHARS = 4000
const TASK_TYPES = new Set(['RETRIEVAL_QUERY', 'RETRIEVAL_DOCUMENT'])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  if (!aplicarGuard(req, res, { max: 60, windowMs: 60_000 })) return

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY no configurada en el servidor' })
    return
  }

  const { text, taskType = 'RETRIEVAL_QUERY' } = req.body || {}
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text es obligatorio' })
    return
  }
  if (text.length > MAX_TEXT_CHARS) {
    res.status(413).json({ error: 'Texto demasiado largo' })
    return
  }
  if (!TASK_TYPES.has(taskType)) {
    res.status(400).json({ error: `taskType no permitido: ${taskType}` })
    return
  }

  try {
    const upstream = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        embedContentConfig: { taskType, outputDimensionality: OUTPUT_DIMENSIONALITY },
      }),
    })
    const body = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: body?.error?.message || `HTTP ${upstream.status}` })
      return
    }
    res.status(200).json({ embedding: body.embedding?.values || [] })
  } catch (err) {
    console.error('[api/embed] Error:', err)
    res.status(502).json({ error: `No se pudo contactar a Gemini: ${err.message}` })
  }
}
