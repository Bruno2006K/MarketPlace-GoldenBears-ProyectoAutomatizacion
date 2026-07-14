/**
 * src/agents/core/langsmithClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cliente de observabilidad LangSmith para el sistema multiagente (ver
 * guia_automatizacion.md, secciones 2.2, 3.2, 5.6 y 8). Envía las trazas a
 * través del proxy serverless /api/trace — la API key vive solo en el
 * servidor, nunca en el bundle del navegador.
 *
 * Es "fire-and-forget": si LangSmith no está configurado o la llamada falla,
 * el flujo transaccional del agente que la invoca no se ve afectado.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { apiHeaders } from './apiHeaders.js'

function enviarTraza(payload) {
  fetch('/api/trace', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(payload),
  }).catch(() => { /* la trazabilidad nunca debe romper el flujo del agente */ })
}

/** traceLLMCall — registra una llamada real a Groq/Gemini como run tipo "llm". */
export function traceLLMCall({ agente, provider, model, system, prompt, output, startTime, endTime, correlationId }) {
  enviarTraza({
    name: `${agente || 'agente'}:${provider}`,
    runType: 'llm',
    inputs: { system, prompt, model },
    outputs: { output },
    tags: ['llm', provider].filter(Boolean),
    startTime,
    endTime,
    correlationId,
  })
}

/**
 * alertHITL — registra la interrupción Human-in-the-loop del ResolutionAgent
 * cuando la confianza de la resolución autónoma es menor a 0.8 (ver sección 5.6).
 */
export function alertHITL({ ticketId, usuarioId, textoQueja, severidad, confianza, correlationId }) {
  enviarTraza({
    name: 'ResolutionAgent:hitl_alert',
    runType: 'chain',
    inputs: { ticketId, usuarioId, textoQueja, severidad },
    outputs: { confianza, needsHumanReview: true },
    tags: ['hitl', 'needs-review', severidad].filter(Boolean),
    correlationId,
  })
}

export default { traceLLMCall, alertHITL }
