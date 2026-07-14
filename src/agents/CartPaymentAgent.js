/**
 * src/agents/CartPaymentAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Agente de Carrito y Pago — valida el carrito y procesa pagos vía Gateway.
 * Migrado de agents/carrito_pago.py (backend Python original).
 *
 * Escucha: carrito.actualizado, pago.iniciado
 * Publica: carrito.validado, pago.procesado, resultado.agente
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { AgentBase } from './core/AgentBase.js'
import { eventBus, EVENT_TYPES } from './core/EventBus.js'
import { sharedMemory, MEMORY_KEYS } from './core/SharedMemory.js'
import { complete } from './core/llmClient.js'
import { validarItemsCarrito, PAYMENT_METHODS, MAX_PAYMENT_ATTEMPTS } from '../domain/pricing.js'
import { uuid } from './core/uuid.js'

const SYSTEM_PROMPT = `
Eres el Agente de Carrito y Pago del Marketplace Golden Bears.

Responsabilidades:
- Validar que los items del carrito tienen stock disponible.
- Calcular totales con IGV 18%.
- Procesar pagos a través del Gateway (tarjeta, transferencia, billetera digital).
- Detectar transacciones sospechosas (montos anómalos).

Reglas: máximo 10 unidades por producto, monto mínimo S/10.00, máximo 3 reintentos de pago.
Responde siempre con estado claro: APROBADO / RECHAZADO / PENDIENTE.
`.trim()

class CartPaymentAgentClass extends AgentBase {
  constructor() {
    super('CartPaymentAgent', SYSTEM_PROMPT, ['gateway_pago', 'validador_carrito', 'detector_fraude'])
    this._catalog = []
    this._intentosFallidos = new Map()

    this.registerTool('validar_carrito', 'Valida stock y calcula totales con IGV', this._validarCarrito)
    this.registerTool('procesar_pago', 'Procesa un pago a través del gateway', this._procesarPago)
  }

  setCatalog(catalog) {
    this._catalog = catalog || []
  }

  async _validarCarrito({ usuarioId, items }, correlationId) {
    const { itemsValidados, subtotal, igv, total, valido, errores } = validarItemsCarrito(items, this._catalog)

    const resultPayload = { usuarioId, items: itemsValidados, subtotal, igv, total, valido, errores }

    sharedMemory.set(MEMORY_KEYS.CART_VALIDATED, resultPayload, this.name)

    eventBus.publish(EVENT_TYPES.CART_VALIDATED, resultPayload, this.name, correlationId)
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: resultPayload, exito: true }, this.name, correlationId)

    return resultPayload
  }

  async _procesarPago({ usuarioId, total, metodoPago = 'tarjeta', items = [] }, correlationId) {
    const metodo = (metodoPago || 'tarjeta').toLowerCase()
    const intentos = this._intentosFallidos.get(usuarioId) || 0

    if (intentos >= MAX_PAYMENT_ATTEMPTS) {
      return this._publicarFallo(usuarioId, total, `Máximo de intentos alcanzado (${MAX_PAYMENT_ATTEMPTS}/${MAX_PAYMENT_ATTEMPTS})`, correlationId)
    }
    if (!PAYMENT_METHODS.includes(metodo)) {
      return this._publicarFallo(usuarioId, total, `Método de pago inválido: ${metodo}`, correlationId)
    }

    const analisis = await complete({
      system: this.systemPrompt,
      prompt: `Analiza la transacción: usuario=${usuarioId}, total=S/${total}, método=${metodo}. ¿Es sospechosa? Responde APROBADO o RECHAZADO con razón breve.`,
      mockFallback: () => (total > 5000
        ? 'RECHAZADO — monto inusualmente alto. Se requiere verificación adicional.'
        : 'APROBADO — transacción dentro de parámetros normales.'),
      agente: this.name,
      correlationId,
    })

    await sleep(300)
    let exito = Math.random() > 0.08
    if (analisis.toUpperCase().includes('RECHAZADO') && total > 5000) exito = false

    const transaccionId = `TXN-${uuid().slice(0, 10).toUpperCase()}`

    let resultPayload
    if (exito) {
      this._intentosFallidos.delete(usuarioId)
      resultPayload = { usuarioId, total, exitoso: true, transaccionId, metodoPago: metodo, items, analisisIA: analisis }
    } else {
      this._intentosFallidos.set(usuarioId, intentos + 1)
      resultPayload = { usuarioId, total, exitoso: false, transaccionId, error: 'Fondos insuficientes o tarjeta rechazada', intento: intentos + 1 }
    }

    sharedMemory.set(MEMORY_KEYS.PAYMENT, resultPayload, this.name)

    eventBus.publish(EVENT_TYPES.PAYMENT_PROCESSED, resultPayload, this.name, correlationId)
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: resultPayload, exito }, this.name, correlationId)

    return resultPayload
  }

  _publicarFallo(usuarioId, total, razon, correlationId) {
    const resultPayload = { usuarioId, total, exitoso: false, transaccionId: `ERR-${uuid().slice(0, 8).toUpperCase()}`, error: razon }
    eventBus.publish(EVENT_TYPES.PAYMENT_PROCESSED, resultPayload, this.name, correlationId)
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: resultPayload, exito: false, error: razon }, this.name, correlationId)
    return resultPayload
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

export const cartPaymentAgent = new CartPaymentAgentClass()
export default cartPaymentAgent
