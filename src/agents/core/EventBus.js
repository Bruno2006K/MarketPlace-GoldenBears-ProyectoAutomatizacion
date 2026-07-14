/**
 * src/agents/core/EventBus.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Sistema de comunicación entre agentes con validación de esquema JSON
 * inspirada en el protocolo MCP (Model Context Protocol).
 *
 * Migrado 1:1 desde la arquitectura de Pardos Chicken (mismo patrón Pub/Sub +
 * validación de schema + correlationId), adaptado a los eventos del dominio
 * de e-commerce del Marketplace Golden Bears:
 *
 *   busqueda.iniciada → busqueda.completada
 *   carrito.actualizado → carrito.validado
 *   pago.iniciado → pago.procesado
 *   pedido.confirmado
 *   inventario.actualizado
 *   notificacion.enviada
 *
 * CORRELATIONID: cuando el Orquestador ejecuta un Swarm (p. ej. Inventario +
 * Notificaciones procesando `pedido.confirmado` en paralelo), genera un único
 * correlationId y lo propaga a ambos agentes, permitiendo trazar en el panel
 * de monitoreo que ambos eventos pertenecen al mismo flujo de compra.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Tipos de eventos soportados por el sistema ────────────────────────────────
export const EVENT_TYPES = {
  // Búsqueda e IA
  SEARCH_STARTED:   'busqueda.iniciada',
  SEARCH_COMPLETED: 'busqueda.completada',

  // Carrito
  CART_UPDATED:   'carrito.actualizado',
  CART_VALIDATED: 'carrito.validado',

  // Pago
  PAYMENT_STARTED:   'pago.iniciado',
  PAYMENT_PROCESSED: 'pago.procesado',

  // Pedidos
  ORDER_CONFIRMED: 'pedido.confirmado',
  ORDER_DISPATCHED: 'pedido.despachado',

  // Inventario
  INVENTORY_UPDATED: 'inventario.actualizado',

  // Notificaciones
  NOTIFICATION_SENT: 'notificacion.enviada',

  // Soporte y Reclamos (ResolutionAgent)
  TICKET_CREATED:   'reclamo.creado',
  TICKET_PROCESSED: 'reclamo.procesado',

  // Sistema / orquestación
  AGENT_RESULT:      'resultado.agente',
  AGENT_STARTED:      'system:agent_started',
  AGENT_COMPLETED:    'system:agent_completed',
  AGENT_ERROR:        'system:agent_error',
  CONFLICT_DETECTED:  'system:conflict_detected',
  CONFLICT_RESOLVED:  'system:conflict_resolved',
}

// ── Campos obligatorios del envelope MCP ──────────────────────────────────────
const MCP_REQUIRED_FIELDS = ['type', 'payload', 'source', 'timestamp', 'correlationId']

/**
 * JSON Schemas por tipo de evento — validan la estructura del PAYLOAD.
 * Espejo de core/schemas.py (PAYLOAD_SCHEMAS) del backend Python original.
 */
const EVENT_PAYLOAD_SCHEMAS = {
  'busqueda.iniciada':      { required: ['query', 'usuarioId'] },
  'busqueda.completada':    { required: ['productos', 'recomendaciones'] },
  'carrito.actualizado':    { required: ['usuarioId', 'items'] },
  'carrito.validado':       { required: ['usuarioId', 'items', 'total', 'valido'] },
  'pago.iniciado':          { required: ['usuarioId', 'total', 'metodoPago'] },
  'pago.procesado':         { required: ['usuarioId', 'total', 'exitoso', 'transaccionId'] },
  'pedido.confirmado':      { required: ['ordenId', 'usuarioId', 'items', 'total'] },
  'pedido.despachado':      { required: ['ordenId', 'numeroGuia'] },
  'inventario.actualizado': { required: ['itemsActualizados', 'exito'] },
  'notificacion.enviada':   { required: ['usuarioId', 'canales', 'exito'] },
  'reclamo.creado':         { required: ['ticketId', 'usuarioId', 'textoQueja'] },
  'reclamo.procesado':      { required: ['ticketId', 'severidad', 'resolucionPropuesta', 'needsHumanReview'] },
  'resultado.agente':       { required: ['agente', 'resultado', 'exito'] },
  'system:agent_started':   { required: ['agentName', 'tool'] },
  'system:agent_completed': { required: ['agentName', 'tool', 'latency', 'success'] },
  'system:agent_error':     { required: ['agentName', 'tool', 'error'] },
  'system:conflict_detected': { required: [] },
  'system:conflict_resolved': { required: [] },
}

function validatePayloadSchema(type, payload) {
  const schema = EVENT_PAYLOAD_SCHEMAS[type]
  if (!schema) return { valid: true, errors: [] }

  const errors = []
  for (const field of schema.required) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      errors.push(`Payload schema error — campo requerido faltante: "${field}" en evento "${type}"`)
    }
  }
  return { valid: errors.length === 0, errors }
}

function validateMCPMessage(message) {
  const errors = []
  for (const field of MCP_REQUIRED_FIELDS) {
    if (message[field] === undefined || message[field] === null) {
      errors.push(`Campo requerido faltante: "${field}"`)
    }
  }
  if (message.type && !Object.values(EVENT_TYPES).includes(message.type)) {
    errors.push(`Tipo de evento desconocido: "${message.type}"`)
  }
  if (message.type && message.payload) {
    const payloadValidation = validatePayloadSchema(message.type, message.payload)
    errors.push(...payloadValidation.errors)
  }
  return { valid: errors.length === 0, errors }
}

// ── Clase principal EventBus ──────────────────────────────────────────────────
class EventBusClass {
  constructor() {
    this._subscribers = new Map()
    this._history = []
    this._messageCount = 0
    this._validationErrors = 0
    this._wsListeners = new Set() // callbacks para UI en tiempo real (SwarmMonitor)
  }

  subscribe(eventType, handler) {
    if (!this._subscribers.has(eventType)) {
      this._subscribers.set(eventType, new Set())
    }
    this._subscribers.get(eventType).add(handler)
    return () => this._subscribers.get(eventType)?.delete(handler)
  }

  /** onEvent — suscripción "wildcard" para paneles de monitoreo en tiempo real. */
  onEvent(callback) {
    this._wsListeners.add(callback)
    return () => this._wsListeners.delete(callback)
  }

  publish(type, payload, source, correlationId = null) {
    const t0 = performance.now()
    const message = {
      type,
      payload,
      source,
      timestamp: new Date().toISOString(),
      correlationId: correlationId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      messageId: ++this._messageCount,
    }

    const { valid, errors } = validateMCPMessage(message)
    if (!valid) {
      this._validationErrors++
      console.error(`[EventBus] Evento RECHAZADO de ${source}:`, errors)
      return null
    }

    this._history.push({ ...message, deliveredTo: [] })

    const handlers = this._subscribers.get(type)
    if (handlers) {
      const lastEntry = this._history[this._history.length - 1]
      handlers.forEach((handler) => {
        try {
          handler(message)
          lastEntry.deliveredTo.push(handler.name || 'anonymous')
        } catch (err) {
          console.error(`[EventBus] Error en handler para ${type}:`, err)
        }
      })
    }

    const latencyMs = Math.round((performance.now() - t0) * 100) / 100
    this._wsListeners.forEach((cb) => {
      try { cb({ ...message, latencyMs }) } catch { /* noop */ }
    })

    return message
  }

  getHistory(limit = 50) {
    return this._history.slice(-limit)
  }

  getMetrics() {
    return {
      totalMessages:    this._messageCount,
      validationErrors: this._validationErrors,
      successMessages:  this._messageCount - this._validationErrors,
      successRate:      this._messageCount > 0
        ? ((this._messageCount - this._validationErrors) / this._messageCount * 100).toFixed(1)
        : '100.0',
      subscriberCount:  [...this._subscribers.values()].reduce((s, set) => s + set.size, 0),
      historySize:      this._history.length,
      schemasRegistered: Object.keys(EVENT_PAYLOAD_SCHEMAS).length,
    }
  }

  getPayloadSchemas() {
    return EVENT_PAYLOAD_SCHEMAS
  }

  clearHistory() {
    this._history = []
  }
}

export const eventBus = new EventBusClass()
export default eventBus
