/**
 * src/agents/NotificationAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Agente de Notificaciones — notifica a cliente y vendedor (WhatsApp simulado
 * + Email real vía Gmail SMTP a través de /api/notify). Migrado de
 * agents/notificaciones.py (backend Python original).
 *
 * Escucha: pedido.confirmado, inventario.actualizado
 * Publica: notificacion.enviada, resultado.agente
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { AgentBase } from './core/AgentBase.js'
import { eventBus, EVENT_TYPES } from './core/EventBus.js'
import { sharedMemory, MEMORY_KEYS } from './core/SharedMemory.js'
import { complete } from './core/llmClient.js'
import { formatSoles } from '../domain/pricing.js'
import { uuid } from './core/uuid.js'
import { buildBuyerEmailHtml, buildSellerEmailHtml, buildStockAlertEmailHtml } from '../domain/emailTemplates.js'

const SYSTEM_PROMPT = `
Eres el Agente de Notificaciones del Marketplace Golden Bears.

Canales: WhatsApp (simulado), Email (Gmail SMTP real).
Nunca envíes más de 3 notificaciones por evento al mismo usuario. Tono amigable, profesional, español peruano.
`.trim()

class NotificationAgentClass extends AgentBase {
  constructor() {
    super('NotificationAgent', SYSTEM_PROMPT, ['whatsapp_api', 'gmail_smtp', 'scheduler_encuestas'])
    this._notificacionesEnviadas = []
    this._encuestasProgramadas = []

    this.registerTool('notificar_pedido', 'Notifica al cliente y vendedor tras confirmar un pedido', this._notificarPedido)
    this.registerTool('notificar_alertas_stock', 'Notifica alertas de inventario al administrador', this._notificarAlertasStock)
  }

  async _notificarPedido({ ordenId, usuarioId, total, facturaId, fechaEntregaEstimada, items = [] }, correlationId) {
    const msgIA = await complete({
      system: this.systemPrompt,
      prompt: `Genera un WhatsApp de confirmación de pedido ${ordenId} por ${formatSoles(total)}. Máx 160 caracteres.`,
      mockFallback: () => `Tu pedido #${ordenId} fue CONFIRMADO por ${formatSoles(total)}. Llegará el ${fechaEntregaEstimada}. Gracias por comprar en Golden Bears.`,
    })

    const waCliente = `Tu pedido #${ordenId} fue CONFIRMADO por ${formatSoles(total)}. Llegará el ${fechaEntregaEstimada}. Gracias por comprar en Golden Bears.`
    const waVendedor = `Nueva orden #${ordenId} — ${items.length} producto(s). Total: ${formatSoles(total)}. Prepara el despacho.`

    const htmlBuyer = buildBuyerEmailHtml({ ordenId, facturaId, items, total, fechaEntrega: fechaEntregaEstimada })
    const htmlSeller = buildSellerEmailHtml({ ordenId, items, total })

    const [emailBuyerOk, emailSellerOk] = await Promise.all([
      this._sendEmail({ subject: `Pedido confirmado #${ordenId} — Golden Bears`, html: htmlBuyer, to: 'comprador' }),
      this._sendEmail({ subject: `[VENDEDOR] Nueva orden #${ordenId} — ${formatSoles(total)}`, html: htmlSeller, to: 'vendedor' }),
    ])

    const encuesta = {
      ordenId, usuarioId,
      programadaPara: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      tipo: 'NPS_encuesta_satisfaccion',
    }
    this._encuestasProgramadas.push(encuesta)

    const notifRecord = {
      notifId: uuid(),
      ordenId, usuarioId,
      timestamp: new Date().toISOString(),
      emailRealEnviado: emailBuyerOk || emailSellerOk,
      mensajes: { whatsappCliente: waCliente, whatsappVendedor: waVendedor, iaPersonalizado: msgIA },
    }
    this._notificacionesEnviadas.push(notifRecord)

    const canales = ['whatsapp_cliente', 'whatsapp_vendedor']
    if (emailBuyerOk) canales.push('email_comprador')
    if (emailSellerOk) canales.push('email_vendedor')

    const resultPayload = {
      usuarioId, ordenId, canales, exito: true, mensaje: waCliente,
      emailRealEnviado: emailBuyerOk || emailSellerOk, encuestaProgramada: encuesta,
      notificaciones: notifRecord.mensajes,
    }

    sharedMemory.set(MEMORY_KEYS.LAST_NOTIFICATION, notifRecord, this.name)
    sharedMemory.set(MEMORY_KEYS.NOTIFICATIONS_TOTAL, this._notificacionesEnviadas.length, this.name)

    eventBus.publish(EVENT_TYPES.NOTIFICATION_SENT, resultPayload, this.name, correlationId)
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: resultPayload, exito: true }, this.name, correlationId)

    return resultPayload
  }

  async _notificarAlertasStock({ alertasStock = [] }, correlationId) {
    if (!alertasStock.length) return { exito: true, mensaje: 'Sin alertas' }

    const html = buildStockAlertEmailHtml(alertasStock)
    await this._sendEmail({ subject: `[ALERTA STOCK] ${alertasStock.map((a) => a.productoId).join(', ')}`, html, to: 'vendedor' })

    const resultPayload = { usuarioId: 'admin', canales: ['email_admin'], exito: true, mensaje: `Alertas de stock: ${alertasStock.length} producto(s).` }
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: resultPayload, exito: true }, this.name, correlationId)
    return resultPayload
  }

  /** _sendEmail — llama a /api/notify (servidor); en modo local/offline degrada a "simulado". */
  async _sendEmail({ subject, html, to }) {
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, html }),
      })
      const body = await res.json().catch(() => ({}))
      return Boolean(body.sent)
    } catch {
      return false
    }
  }

  getNotifications() { return this._notificacionesEnviadas }
  getScheduledSurveys() { return this._encuestasProgramadas }
}

export const notificationAgent = new NotificationAgentClass()
export default notificationAgent
