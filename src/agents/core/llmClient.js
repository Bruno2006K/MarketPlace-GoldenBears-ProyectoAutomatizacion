/**
 * src/agents/core/llmClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Wrapper LLM para todo el sistema. Soporta los dos proveedores definidos en
 * guia_automatizacion.md (secciones 5.1 y 9.2), ambos detrás del proxy
 * serverless /api/llm para que la API key nunca viaje al navegador:
 *   · Groq (Llama 3.1 8B)   → clasificación rápida y económica
 *     (Orquestador, ResolutionAgent).
 *   · Gemini 1.5 Flash      → RAG / búsqueda semántica
 *     (ConciergeAgent / SearchAgent).
 *
 * Dos modos (equivalente a MODE=demo/production del backend Python):
 *   · 'proxy' → VITE_USE_PROXY === 'true': llama a /api/llm (key server-side).
 *   · 'mock'  → heurística local determinística (demo offline, sin costo).
 *
 * Cada llamada real al proxy (modo 'proxy') se registra en LangSmith vía
 * langsmithClient.traceLLMCall — observabilidad opcional que no afecta el
 * flujo si LangSmith no está configurado (ver sección 6 de la guía).
 *
 * Expone:
 *   complete({ system, prompt, model, agente })  → texto plano
 *   MODELOS.GROQ_LLAMA / MODELOS.GEMINI_FLASH
 *   llmMode → 'proxy' | 'mock'
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { traceLLMCall } from './langsmithClient.js'
import { apiHeaders } from './apiHeaders.js'

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {}
const useProxy = ENV.VITE_USE_PROXY === 'true'

export const llmMode = useProxy ? 'proxy' : 'mock'

export const MODELOS = {
  GROQ_LLAMA: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  GEMINI_FLASH: { provider: 'gemini', model: 'gemini-1.5-flash' },
}

const MODELO_POR_DEFECTO = MODELOS.GROQ_LLAMA

if (llmMode === 'mock') {
  console.warn(
    '[llmClient] Modo MOCK (heurística local, sin costo). ' +
    'Configura VITE_USE_PROXY=true + GROQ_API_KEY/GEMINI_API_KEY en el servidor para respuestas reales.'
  )
}

const MAX_RETRIES = 2
const MAX_BACKOFF_MS = 6000

async function withRetry(fn, { retries = MAX_RETRIES, label = 'llm' } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = err?.status
      const retryable = status === 429 || status === 503
      if (!retryable || attempt === retries) break
      const waitMs = Math.min(2 ** attempt * 1000, MAX_BACKOFF_MS)
      console.warn(`[llmClient] ${label}: ${status}, reintento ${attempt + 1}/${retries} en ${waitMs}ms`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastErr
}

/**
 * complete — Llama al proxy /api/llm (modo producción) o cae a la heurística
 * mock si no hay proxy configurado. Cada agente pasa su propio mockFallback
 * para que la respuesta simulada sea coherente con su dominio de negocio
 * (equivalente a los métodos `_mock_response` del backend Python), y opcio-
 * nalmente su `model` (MODELOS.GROQ_LLAMA por defecto, MODELOS.GEMINI_FLASH
 * para tareas de búsqueda semántica).
 */
export async function complete({ system, prompt, mockFallback, temperature = 0.4, model = MODELO_POR_DEFECTO, agente, correlationId }) {
  if (llmMode === 'mock') {
    return typeof mockFallback === 'function' ? mockFallback() : 'Procesado en modo demo.'
  }

  const startTime = new Date().toISOString()
  try {
    const texto = await withRetry(async () => {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          provider: model.provider,
          model: model.model,
          temperature,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error(JSON.stringify(body)), { status: res.status })
      return body.content?.[0]?.text || (typeof mockFallback === 'function' ? mockFallback() : '')
    }, { label: 'complete' })

    traceLLMCall({
      agente, correlationId, system, prompt, output: texto,
      provider: model.provider, model: model.model,
      startTime, endTime: new Date().toISOString(),
    })

    return texto
  } catch (err) {
    console.warn('[llmClient] Proxy falló, usando mock:', err.message)
    return typeof mockFallback === 'function' ? mockFallback() : 'Procesado en modo demo.'
  }
}

export default { complete, llmMode, MODELOS }
