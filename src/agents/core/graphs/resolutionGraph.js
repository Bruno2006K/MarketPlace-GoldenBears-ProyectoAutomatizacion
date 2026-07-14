/**
 * src/agents/core/graphs/resolutionGraph.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Grafo de resolución de reclamos (ver guia_automatizacion.md, sección 5.6):
 * Nodo real de LangGraph.js con arista condicional + checkpointer por hilo
 * (thread_id = correlationId).
 *
 *   START → analizar ─┬─(needsHumanReview=false)→ END
 *                      └─(needsHumanReview=true)→ esperarRevisionHumana → END
 *
 * El ticket (con su propuesta de resolución) se persiste en `analizar` para
 * que el cliente reciba una respuesta inmediata; `esperarRevisionHumana` es
 * el nodo que representa la pausa HITL del diagrama de la guía.
 *
 * NOTA — por qué no usamos `interrupt()` de LangGraph.js: esa API depende de
 * `AsyncLocalStorage` (node:async_hooks), disponible en Node/Deno/Cloudflare
 * Workers pero NO en navegadores. Como todo el sistema multiagente corre
 * client-side (ver README), llamar a `interrupt()` aquí lanza "Called
 * interrupt() outside the context of a graph" en cualquier navegador real. La
 * pausa HITL se aplica entonces a nivel de aplicación: el ticket queda con
 * `estado: 'revision_pendiente'` hasta que `AgentOrchestrator.
 * resolverTicketManualmente()` lo resuelve — mismo efecto observable, sin
 * depender de una API que no existe en el navegador.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { StateGraph, StateSchema, START, END, MemorySaver } from '@langchain/langgraph'
import { z } from 'zod'
import { resolutionAgent } from '../../ResolutionAgent.js'

const ResolutionState = new StateSchema({
  usuarioId:     z.string(),
  ordenId:       z.string().nullable().default(null),
  textoQueja:    z.string(),
  correlationId: z.string(),
  ticket:        z.any().nullable().default(null),
})

async function nodoAnalizar(state) {
  const r = await resolutionAgent.execute('procesar_reclamo', {
    usuarioId: state.usuarioId, ordenId: state.ordenId, textoQueja: state.textoQueja,
  }, state.correlationId)
  return { ticket: r.result }
}

/**
 * esperarRevisionHumana — nodo terminal que representa la pausa HITL del
 * diagrama de la guía. El ticket ya quedó persistido con
 * `estado: 'revision_pendiente'` en `analizar`; la resolución real llega de
 * forma asíncrona vía `AgentOrchestrator.resolverTicketManualmente()`, fuera
 * de este grafo (ver nota de cabecera sobre por qué no usamos `interrupt()`).
 */
async function nodoEsperarRevisionHumana() {
  return {}
}

const builder = new StateGraph(ResolutionState)
  .addNode('analizar', nodoAnalizar)
  .addNode('esperarRevisionHumana', nodoEsperarRevisionHumana)
  .addEdge(START, 'analizar')
  .addConditionalEdges('analizar', (state) => (state.ticket?.needsHumanReview ? 'esperarRevisionHumana' : END))
  .addEdge('esperarRevisionHumana', END)

export const resolutionGraph = builder.compile({ checkpointer: new MemorySaver() })

export default resolutionGraph
