/**
 * api/llm.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxy serverless hacia los proveedores de LLM del sistema multiagente
 * (ver guia_automatizacion.md, secciones 5.1 y 9.2): Groq (Llama 3.1 8B) para
 * clasificación rápida/económica (Orquestador, ResolutionAgent) y Gemini 1.5
 * Flash para tareas de RAG/búsqueda semántica (ConciergeAgent/SearchAgent).
 *
 * Las keys viven SOLO en el servidor (process.env.GROQ_API_KEY /
 * process.env.GEMINI_API_KEY), nunca en el bundle del navegador.
 *
 * En desarrollo, vite.config.js monta este mismo handler en /api/llm, así que
 * el código que se prueba localmente es el mismo que corre en Vercel.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { aplicarGuard } from './_guard.js'

const PROVEEDORES = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    modelosPermitidos: new Set(['llama-3.1-8b-instant']),
    apiKeyEnv: 'GROQ_API_KEY',
    llamar: llamarGroq,
  },
  gemini: {
    url: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    modelosPermitidos: new Set(['gemini-1.5-flash']),
    apiKeyEnv: 'GEMINI_API_KEY',
    llamar: llamarGemini,
  },
}

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

  const { provider = 'groq', model, messages = [], temperature = 0.4 } = req.body || {}

  const proveedor = PROVEEDORES[provider]
  if (!proveedor) {
    res.status(400).json({ error: `Proveedor no soportado: ${provider}` })
    return
  }
  if (!model || !proveedor.modelosPermitidos.has(model)) {
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

  const apiKey = process.env[proveedor.apiKeyEnv]
  if (!apiKey) {
    res.status(500).json({ error: `${proveedor.apiKeyEnv} no configurada en el servidor` })
    return
  }

  const systemMsg = messages.find((m) => m.role === 'system')?.content || ''
  const turnos = messages.filter((m) => m.role !== 'system')

  try {
    const texto = await proveedor.llamar({ model, apiKey, systemMsg, turnos, temperature })
    res.status(200).json({ content: [{ text: texto }] })
  } catch (err) {
    console.error('[api/llm] Error:', err)
    res.status(err.status || 502).json({ error: `No se pudo contactar a ${provider}: ${err.message}` })
  }
}

// Groq expone una API compatible con OpenAI Chat Completions.
async function llamarGroq({ model, apiKey, systemMsg, turnos, temperature }) {
  const upstream = await fetch(PROVEEDORES.groq.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: 512,
      messages: [{ role: 'system', content: systemMsg }, ...turnos],
    }),
  })
  const body = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    throw Object.assign(new Error(body?.error?.message || `HTTP ${upstream.status}`), { status: upstream.status })
  }
  return body.choices?.[0]?.message?.content || ''
}

// Gemini separa el system prompt (systemInstruction) del historial de turnos
// y usa el rol "model" en lugar de "assistant".
async function llamarGemini({ model, apiKey, systemMsg, turnos, temperature }) {
  const url = `${PROVEEDORES.gemini.url(model)}?key=${apiKey}`
  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg }] } } : {}),
      contents: turnos.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature, maxOutputTokens: 512 },
    }),
  })
  const body = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    throw Object.assign(new Error(body?.error?.message || `HTTP ${upstream.status}`), { status: upstream.status })
  }
  return body.candidates?.[0]?.content?.parts?.[0]?.text || ''
}
