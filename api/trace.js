/**
 * api/trace.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxy serverless hacia LangSmith (observabilidad, ver guia_automatizacion.md
 * secciones 2.2, 3.2, 5.6 y 8). Registra dos tipos de traza:
 *   · run_type "llm"   → cada llamada a Groq/Gemini vía /api/llm.
 *   · run_type "chain" → alertas HITL del ResolutionAgent cuando la confianza
 *     de una resolución autónoma es menor a 0.8.
 *
 * La API key vive solo en el servidor (process.env.LANGSMITH_API_KEY). Si
 * LANGSMITH_TRACING no está activo o falta la key, responde { disabled: true }
 * sin error: la trazabilidad es opcional y nunca debe romper el flujo
 * transaccional de los agentes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { aplicarGuard } from './_guard.js'
import { uuid } from '../src/agents/core/uuid.js'

const LANGSMITH_URL = 'https://api.smith.langchain.com/runs'
const MAX_BODY_CHARS = 20000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  // Volumen esperado: 1 traza por llamada LLM + alertas HITL puntuales.
  if (!aplicarGuard(req, res, { max: 60, windowMs: 60_000 })) return

  const tracingActivo = process.env.LANGSMITH_TRACING === 'true'
  const apiKey = process.env.LANGSMITH_API_KEY
  if (!tracingActivo || !apiKey) {
    res.status(200).json({ disabled: true })
    return
  }

  if (JSON.stringify(req.body || {}).length > MAX_BODY_CHARS) {
    res.status(413).json({ error: 'Payload demasiado grande' })
    return
  }

  const { name, runType = 'chain', inputs = {}, outputs = {}, tags = [], error = null, startTime, endTime, correlationId } = req.body || {}
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name es obligatorio' })
    return
  }

  const now = new Date().toISOString()
  const payload = {
    id: uuid(),
    name,
    run_type: runType,
    inputs,
    outputs,
    error,
    start_time: startTime || now,
    end_time: endTime || now,
    session_name: process.env.LANGSMITH_PROJECT || 'marketplace-goldenbears-sma',
    extra: { metadata: { correlationId } },
    tags,
  }

  try {
    const upstream = await fetch(LANGSMITH_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!upstream.ok) {
      console.warn('[api/trace] LangSmith respondió', upstream.status, await upstream.text().catch(() => ''))
    }
    res.status(200).json({ traced: upstream.ok })
  } catch (err) {
    // La trazabilidad nunca debe tumbar al agente que la invoca.
    console.error('[api/trace] Error:', err)
    res.status(200).json({ traced: false, error: err.message })
  }
}
