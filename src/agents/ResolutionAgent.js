/**
 * src/agents/ResolutionAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Agente de Resolución de Reclamos y Soporte Técnico (ResolutionAgent).
 * Implementa el patrón ReAct y evaluación de severidad del reclamo.
 *
 * Escucha: reclamo.creado
 * Publica: reclamo.procesado, resultado.agente
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { AgentBase } from './core/AgentBase.js'
import { eventBus, EVENT_TYPES } from './core/EventBus.js'
import { sharedMemory, MEMORY_KEYS } from './core/SharedMemory.js'
import { complete, MODELOS } from './core/llmClient.js'
import { alertHITL } from './core/langsmithClient.js'
import { uuid } from './core/uuid.js'

const SYSTEM_PROMPT = `
Eres el Agente de Resolución (ResolutionAgent) del Marketplace Golden Bears.

Especialidades:
- Clasificación de severidad de reclamos (baja, media, alta).
- Análisis de quejas sobre productos dañados, cobros duplicados, retrasos de envío.
- Generación de propuestas de resolución (reembolso parcial, cupón de compensación, cambio de producto).
- Evaluación de confianza en la resolución autónoma.
- Interrupción y derivación a revisión humana (Human-in-the-loop) cuando la confianza es < 0.8.
`.trim()

class ResolutionAgentClass extends AgentBase {
  constructor() {
    super('ResolutionAgent', SYSTEM_PROMPT, ['clasificador_tickets', 'politicas_reembolso', 'detector_fraude'])
    this._ticketsStore = []

    this.registerTool('procesar_reclamo', 'Procesa una queja o reclamo de cliente y genera propuesta de resolución', this._procesarReclamo)
  }

  async _procesarReclamo({ usuarioId, ordenId = null, textoQueja }, correlationId) {
    if (!usuarioId || !textoQueja) {
      throw new Error('usuarioId y textoQueja son obligatorios para procesar un reclamo')
    }

    const ticketId = `TKT-${uuid().slice(0, 8).toUpperCase()}`
    
    // Simular razonamiento ReAct (Thought -> Action -> Observation -> Thought)
    const razonamientoReAct = await complete({
      system: this.systemPrompt,
      prompt: `Reclamo de usuario: "${textoQueja}". Orden relacionada: "${ordenId || 'No provista'}".
Analiza y describe tu razonamiento en formato ReAct (Pensamiento, Acción, Observación) para determinar la severidad y la propuesta de resolución.`,
      mockFallback: () => {
        const severidadSugerida = this._deducirSeveridad(textoQueja)
        return `Pensamiento: El usuario reporta un problema de severidad ${severidadSugerida.toUpperCase()}. Necesito consultar el historial de órdenes para validar.
Acción: Consultar historial de la orden ${ordenId || 'N/A'}.
Observación: Se encontró coincidencia en el historial transaccional del cliente.
Pensamiento: Generar propuesta lícita de compensación basada en la política de reembolso.`;
      },
      model: MODELOS.GROQ_LLAMA,
      agente: this.name,
      correlationId,
    })

    // Calcular heurística de confianza y severidad
    const severidad = this._deducirSeveridad(textoQueja)
    
    // Si la queja contiene palabras críticas o sospechosas, bajamos la confianza para forzar HITL
    const esCritico = /\brot[oa]s?\b/.test(textoQueja.toLowerCase()) || 
                      textoQueja.toLowerCase().includes('estafa') || 
                      textoQueja.toLowerCase().includes('legal') ||
                      /\bmalogr/.test(textoQueja.toLowerCase()) ||
                      /\bdevoluci[oó]n\b/.test(textoQueja.toLowerCase())
                      
    const confianza = esCritico ? 0.65 : 0.90
    const needsHumanReview = confianza < 0.80

    // Generar propuesta de resolución
    const resolucionPropuesta = await complete({
      system: this.systemPrompt,
      prompt: `Genera una respuesta cordial al cliente proponiendo una solución para la queja: "${textoQueja}". Severidad: ${severidad}.`,
      mockFallback: () => {
        if (severidad === 'alta') {
          return `Lamentamos el inconveniente. Hemos procesado una solicitud de reembolso del 100% o cambio inmediato de producto.`
        } else if (severidad === 'media') {
          return `Disculpe las molestias. Le ofrecemos un cupón de descuento de S/20 para su siguiente compra.`
        } else {
          return `Agradecemos sus comentarios. Estaremos mejorando el empaque de nuestros envíos.`
        }
      },
      model: MODELOS.GROQ_LLAMA,
      agente: this.name,
      correlationId,
    })

    const resultPayload = {
      ticketId,
      usuarioId,
      ordenId,
      textoQueja,
      severidad,
      resolucionPropuesta,
      confianza,
      needsHumanReview,
      estado: needsHumanReview ? 'revision_pendiente' : 'resuelto_autonomo',
      fechaCreacion: new Date().toISOString()
    }

    this._ticketsStore.push(resultPayload)

    // HITL: confianza < 0.8 → el flujo se interrumpe para revisión humana y
    // se registra la alerta en LangSmith (ver guia_automatizacion.md, 5.6).
    if (needsHumanReview) {
      alertHITL({ ticketId, usuarioId, textoQueja, severidad, confianza, correlationId })
    }

    // Escribir en memoria compartida
    sharedMemory.set(MEMORY_KEYS.TICKET, resultPayload, this.name)
    sharedMemory.set(MEMORY_KEYS.TICKETS_STORE, [...this._ticketsStore], this.name)

    // Publicar eventos
    eventBus.publish(EVENT_TYPES.TICKET_PROCESSED, resultPayload, this.name, correlationId)
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: resultPayload, exito: true }, this.name, correlationId)

    return resultPayload
  }

  _deducirSeveridad(queja) {
    const q = queja.toLowerCase()
    if (/\brot[oa]s?\b/.test(q) || q.includes('estafa') || q.includes('no llego') || q.includes('perdido') || /\bmalogr/.test(q)) {
      return 'alta'
    }
    if (q.includes('demora') || q.includes('tarde') || q.includes('color') || q.includes('equivocado')) {
      return 'media'
    }
    return 'baja'
  }

  getTicketsStore() {
    return this._ticketsStore
  }

  resolverTicketManualmente(ticketId, resolucionAprobada, estadoFinal = 'resuelto_humano') {
    const ticket = this._ticketsStore.find((t) => t.ticketId === ticketId)
    if (!ticket) return { exito: false, error: 'Ticket no encontrado' }
    
    ticket.resolucionPropuesta = resolucionAprobada
    ticket.estado = estadoFinal
    ticket.needsHumanReview = false

    sharedMemory.set(MEMORY_KEYS.TICKETS_STORE, [...this._ticketsStore], this.name)
    eventBus.publish(EVENT_TYPES.TICKET_PROCESSED, { ...ticket }, this.name)

    return { exito: true, ticketId, estado: estadoFinal }
  }
}

export const resolutionAgent = new ResolutionAgentClass()
export default resolutionAgent
