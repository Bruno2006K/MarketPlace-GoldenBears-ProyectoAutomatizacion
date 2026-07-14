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

Tu única tarea es REDACTAR la comunicación al cliente. La severidad y la
compensación YA fueron decididas por reglas de negocio deterministas y se te
entregan en el prompt de cada turno — nunca las cambies, inventes montos
distintos, ni ofrezcas algo que no se te indicó explícitamente.

Reglas de estilo:
- Máximo 3 frases. Cordial, directo, sin relleno genérico ("lamentamos las
  molestias" repetido, frases vacías).
- Menciona el producto/orden si el cliente lo dio.
- Nunca prometas plazos ni montos que no estén en la compensación entregada.
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

    // Decisión determinista PRIMERO (anti-alucinación, ver guia_automatizacion.md
    // sección 6): severidad, confianza y compensación nunca las decide el LLM,
    // solo las redacta. Así ambos prompts quedan grounded en el mismo hecho.
    const severidad = this._deducirSeveridad(textoQueja)
    const compensacion = this._definirCompensacion(severidad)

    // Si la queja contiene palabras críticas o sospechosas, bajamos la confianza para forzar HITL
    const esCritico = /\brot[oa]s?\b/.test(textoQueja.toLowerCase()) ||
                      textoQueja.toLowerCase().includes('estafa') ||
                      textoQueja.toLowerCase().includes('legal') ||
                      /\bmalogr/.test(textoQueja.toLowerCase()) ||
                      /\bdevoluci[oó]n\b/.test(textoQueja.toLowerCase())

    const confianza = esCritico ? 0.65 : 0.90
    const needsHumanReview = confianza < 0.80

    // Razonamiento ReAct (Thought -> Action -> Observation -> Thought), ya
    // consistente con la severidad/compensación reales (no las re-adivina).
    const razonamientoReAct = await complete({
      system: this.systemPrompt,
      prompt: `Reclamo: "${textoQueja}". Orden relacionada: "${ordenId || 'No provista'}".
Severidad ya clasificada: ${severidad}. Compensación ya decidida: ${compensacion.descripcion}.
Describe en formato ReAct (Pensamiento, Acción, Observación) por qué esta severidad y esta compensación son las correctas para este caso puntual — sé específico sobre el detalle de la queja, no genérico.`,
      mockFallback: () => `Pensamiento: El usuario reporta un problema de severidad ${severidad.toUpperCase()}. Necesito consultar el historial de órdenes para validar.
Acción: Consultar historial de la orden ${ordenId || 'N/A'}.
Observación: Se encontró coincidencia en el historial transaccional del cliente.
Pensamiento: Aplicar la política de compensación: ${compensacion.descripcion}.`,
      model: MODELOS.GROQ_LLAMA,
      agente: this.name,
      correlationId,
    })

    // Redacción final — el LLM solo comunica la compensación ya decidida.
    const resolucionPropuesta = await complete({
      system: this.systemPrompt,
      prompt: `Redacta la respuesta final para el cliente sobre su reclamo: "${textoQueja}"${ordenId ? ` (orden ${ordenId})` : ''}.
Compensación EXACTA a comunicar (no cambies el tipo ni el monto): ${compensacion.descripcion}.`,
      mockFallback: () => `Lamentamos el inconveniente. Le confirmamos: ${compensacion.descripcion}.`,
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
      compensacion,
      resolucionPropuesta,
      razonamientoReAct,
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

  /**
   * _definirCompensacion — política de negocio determinista (anti-alucinación):
   * el LLM nunca decide montos ni tipo de compensación, solo los redacta.
   */
  _definirCompensacion(severidad) {
    if (severidad === 'alta') {
      return {
        tipo: 'reembolso_total',
        valor: 100,
        descripcion: 'reembolso del 100% del monto pagado o cambio inmediato del producto, a elección del cliente, en un plazo máximo de 3 días hábiles',
      }
    }
    if (severidad === 'media') {
      return {
        tipo: 'cupon_descuento',
        valor: 20,
        descripcion: 'un cupón de S/20 de descuento válido para su próxima compra',
      }
    }
    return {
      tipo: 'agradecimiento',
      valor: 0,
      descripcion: 'agradecimiento por el comentario y el compromiso de mejorar el empaque/proceso de envío',
    }
  }

  getTicketsStore() {
    return this._ticketsStore
  }

  /**
   * registrarTicketChat — usado por resolutionChatGraph.js (chat conversacional
   * multi-turno) para persistir un ticket ya resuelto o escalado, con el mismo
   * store/eventos que _procesarReclamo — así el panel de vendedor y el Monitor
   * SMA funcionan igual sin importar si el ticket vino del chat o del flujo
   * de un solo turno.
   */
  registrarTicketChat(ticket, correlationId) {
    this._ticketsStore.push(ticket)
    sharedMemory.set(MEMORY_KEYS.TICKET, ticket, this.name)
    sharedMemory.set(MEMORY_KEYS.TICKETS_STORE, [...this._ticketsStore], this.name)
    eventBus.publish(EVENT_TYPES.TICKET_PROCESSED, ticket, this.name, correlationId)
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: ticket, exito: true }, this.name, correlationId)
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
