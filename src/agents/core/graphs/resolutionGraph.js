/**
 * src/agents/core/graphs/resolutionGraph.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Grafo de resolución de reclamos con Human-in-the-loop REAL vía LangGraph.js
 * (ver guia_automatizacion.md, sección 5.6): cuando la confianza de la
 * resolución autónoma es < 0.8, el grafo se interrumpe con `interrupt()` —
 * el checkpointer congela el estado del hilo (thread_id = correlationId) hasta
 * que `AgentOrchestrator.resolverTicketManualmente()` lo reanuda con
 * `new Command({ resume })`.
 *
 *   START → analizar ─┬─(needsHumanReview=false)→ END
 *                      └─(needsHumanReview=true)→ esperarRevisionHumana ⏸ → END
 *
 * El ticket (con su propuesta de resolución) se persiste en `analizar` — igual
 * que antes — para que el cliente reciba una respuesta inmediata; la
 * interrupción es la señal de que el caso queda pendiente de aprobación
 * humana y el hilo del grafo puede reanudarse más tarde.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { StateGraph, StateSchema, START, END, MemorySaver, interrupt } from '@langchain/langgraph'
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

/** esperarRevisionHumana — interrupción real: el grafo pausa hasta que un humano resuelva. */
async function nodoEsperarRevisionHumana(state) {
  interrupt({
    motivo: 'confianza_baja',
    ticketId: state.ticket?.ticketId,
    severidad: state.ticket?.severidad,
    confianza: state.ticket?.confianza,
  })
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
