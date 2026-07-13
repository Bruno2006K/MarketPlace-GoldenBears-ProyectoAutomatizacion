/**
 * src/agents/core/llmClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Wrapper LLM para todo el sistema. Simplificado respecto al de Pardos Chicken
 * (que soportaba Gemini/Groq/LangChain): el Marketplace Golden Bears original
 * en Python usaba Claude Haiku vía Anthropic, así que aquí se mantiene un solo
 * proveedor (Anthropic) detrás de un proxy serverless — mismo patrón de
 * seguridad (la key nunca viaja al navegador) sin la complejidad multi-proveedor
 * que este proyecto no necesita.
 *
 * Dos modos (equivalente a MODE=demo/production del backend Python):
 *   · 'proxy' → VITE_USE_PROXY === 'true': llama a /api/llm (key server-side).
 *   · 'mock'  → heurística local determinística (demo offline, sin costo).
 *
 * Expone:
 *   complete({ system, prompt })  → texto plano
 *   llmMode → 'proxy' | 'mock'
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {}
const useProxy = ENV.VITE_USE_PROXY === 'true'

export const llmMode = useProxy ? 'proxy' : 'mock'
export const llmModel = llmMode === 'mock' ? null : 'claude-haiku-4-5-20251001'

if (llmMode === 'mock') {
  console.warn(
    '[llmClient] Modo MOCK (heurística local, sin costo). ' +
    'Configura VITE_USE_PROXY=true + ANTHROPIC_API_KEY en el servidor para respuestas reales de Claude.'
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
 * (equivalente a los métodos `_mock_response` del backend Python).
 */
export async function complete({ system, prompt, mockFallback, temperature = 0.4 }) {
  if (llmMode === 'mock') {
    return typeof mockFallback === 'function' ? mockFallback() : 'Procesado en modo demo.'
  }

  try {
    return await withRetry(async () => {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: llmModel,
          temperature,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error(JSON.stringify(body)), { status: res.status })
      return body.content?.[0]?.text || body.content || (typeof mockFallback === 'function' ? mockFallback() : '')
    }, { label: 'complete' })
  } catch (err) {
    console.warn('[llmClient] Proxy falló, usando mock:', err.message)
    return typeof mockFallback === 'function' ? mockFallback() : 'Procesado en modo demo.'
  }
}

export default { complete, llmMode, llmModel }
