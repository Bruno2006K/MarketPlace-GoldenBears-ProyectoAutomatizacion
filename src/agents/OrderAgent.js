/**
 * src/agents/OrderAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Agente de Pedidos — crea la orden y genera la factura electrónica.
 * Migrado de agents/pedidos.py (backend Python original).
 *
 * Escucha: pago.procesado
 * Publica: pedido.confirmado, resultado.agente
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { AgentBase } from './core/AgentBase.js'
import { eventBus, EVENT_TYPES } from './core/EventBus.js'
import { sharedMemory, MEMORY_KEYS } from './core/SharedMemory.js'
import { complete } from './core/llmClient.js'
import { formatSoles } from '../domain/pricing.js'
import { uuid } from './core/uuid.js'

const SYSTEM_PROMPT = `
Eres el Agente de Pedidos del Marketplace Golden Bears.

Responsabilidades:
- Crear la orden de compra.
- Generar la factura electrónica (serie F001, correlativo de 8 dígitos, IGV 18%).
- Asignar número de seguimiento único y fecha estimada de entrega.
`.trim()

class OrderAgentClass extends AgentBase {
  constructor() {
    super('OrderAgent', SYSTEM_PROMPT, ['bd_pedidos', 'generador_facturas', 'tracker_envios'])
    this._correlativo = 1000
    this._ordersStore = []

    this.registerTool('crear_orden', 'Crea una orden confirmada tras un pago exitoso', this._crearOrden)
  }

  async _crearOrden({ usuarioId, total, items = [], transaccionId, exitoso }, correlationId) {
    if (!exitoso) {
      const failPayload = { motivo: 'pago_fallido' }
      eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: failPayload, exito: false, error: 'Pago no completado' }, this.name, correlationId)
      return { creado: false, motivo: 'pago_fallido' }
    }

    const ordenId = `ORD-${uuid().slice(0, 8).toUpperCase()}`
    const facturaId = this._generarNumeroFactura()
    const fechaEntrega = this._calcularFechaEntrega()

    const mensajeConfirmacion = await complete({
      system: this.systemPrompt,
      prompt: `Orden creada: ${ordenId}. Total: S/${total}. Items: ${items.length}. Genera mensaje de confirmación para el cliente en 1 oración.`,
      mockFallback: () => `¡Tu pedido ${ordenId} ha sido confirmado! Recibirás ${formatSoles(total)} en tu comprobante. Entrega en 3 días hábiles.`,
      agente: this.name,
      correlationId,
    })

    const resultPayload = {
      ordenId, usuarioId, items, total, facturaId, transaccionId,
      estado: 'confirmado',
      fechaCreacion: new Date().toISOString(),
      fechaEntregaEstimada: fechaEntrega,
      mensajeConfirmacion,
    }

    this._ordersStore.push({
      ordenId, usuarioId, items, total, facturaId,
      fechaEntregaEstimada: fechaEntrega,
      fechaCreacion: resultPayload.fechaCreacion,
      estado: 'pendiente',
      etiquetaGenerada: false,
    })

    sharedMemory.set(MEMORY_KEYS.ORDER, resultPayload, this.name)
    sharedMemory.set(MEMORY_KEYS.ORDERS_STORE, [...this._ordersStore], this.name)

    eventBus.publish(EVENT_TYPES.ORDER_CONFIRMED, resultPayload, this.name, correlationId)
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: resultPayload, exito: true }, this.name, correlationId)

    return { creado: true, ...resultPayload }
  }

  /** despacharOrden — usado por el panel Vendedor (Feature seller/orders). */
  despacharOrden(ordenId, numeroGuia) {
    const pedido = this._ordersStore.find((o) => o.ordenId === ordenId)
    if (!pedido) return { exito: false, error: 'Pedido no encontrado' }
    if (pedido.estado === 'despachado') return { exito: false, error: 'Pedido ya fue despachado' }

    const guia = numeroGuia || `GUIA-${uuid().slice(0, 8).toUpperCase()}`
    pedido.estado = 'despachado'
    pedido.etiquetaGenerada = true
    pedido.numeroGuia = guia
    pedido.fechaDespacho = new Date().toISOString()

    sharedMemory.set(MEMORY_KEYS.ORDERS_STORE, [...this._ordersStore], this.name)
    eventBus.publish(EVENT_TYPES.ORDER_DISPATCHED, { ordenId, numeroGuia: guia }, this.name)

    return { exito: true, ordenId, numeroGuia: guia, estado: 'despachado' }
  }

  getOrdersStore() {
    return this._ordersStore
  }

  _generarNumeroFactura() {
    this._correlativo += 1
    return `F001-${String(this._correlativo).padStart(8, '0')}`
  }

  _calcularFechaEntrega() {
    const entrega = new Date()
    entrega.setDate(entrega.getDate() + 3)
    return entrega.toISOString().slice(0, 10)
  }
}

export const orderAgent = new OrderAgentClass()
export default orderAgent
