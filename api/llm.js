/**
 * api/llm.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxy serverless hacia la API de Anthropic (Claude Haiku).
 *
 * Adaptado del api/llm.js de Pardos Chicken (que hablaba con Groq): aquí se
 * simplifica a un único proveedor porque el Marketplace Golden Bears original
 * en Python usaba ANTHROPIC_API_KEY + claude-haiku-4-5. La key vive SOLO en el
 * servidor (process.env.ANTHROPIC_API_KEY), nunca en el bundle del navegador.
 *
 * En desarrollo, vite.config.js monta este mismo handler en /api/llm, así que
 * el código que se prueba localmente es el mismo que corre en Vercel.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { aplicarGuard } from './_guard.js'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODELOS_PERMITIDOS = new Set(['claude-haiku-4-5-20251001'])
const MAX_MESSAGES = 20
const MAX_BODY_CHARS = 30000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  // Control de acceso: origen permitido + rate-limit (agentes hacen 1 llamada
  // por evento; 40/min deja holgura de sobra y frena el abuso de cuota).
  if (!aplicarGuard(req, res, { max: 40, windowMs: 60_000 })) return

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en el servidor' })
    return
  }

  const { model = 'claude-haiku-4-5-20251001', messages = [], temperature = 0.4 } = req.body || {}

  if (!MODELOS_PERMITIDOS.has(model)) {
    res.status(400).json({ error: `Modelo no permitido: ${model}` })
    return
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    res.status(400).json({ error: 'messages debe ser un array de 1 a 20 mensajes' })
    return
  }
  if (JSON.stringify(messages).length > MAX_BODY_CHARS) {
    res.status(413).json({ error: 'Payload demasiado grande' })
    return
  }

  // Anthropic separa el mensaje "system" del array de turnos user/assistant.
  const systemMsg = messages.find((m) => m.role === 'system')?.content || ''
  const turnos = messages.filter((m) => m.role !== 'system')

  try {
    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        temperature,
        system: systemMsg,
        messages: turnos,
      }),
    })
    const body = await upstream.json()
    res.status(upstream.status).json(body)
  } catch (err) {
    console.error('[api/llm] Error:', err)
    res.status(502).json({ error: `No se pudo contactar a Anthropic: ${err.message}` })
  }
}
