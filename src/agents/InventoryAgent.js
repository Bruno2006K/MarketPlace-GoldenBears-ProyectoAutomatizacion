/**
 * src/agents/InventoryAgent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Agente de Inventario — verifica y actualiza stock en tiempo real.
 * Migrado de agents/inventario.py (backend Python original).
 * Se ejecuta EN PARALELO con NotificationAgent cuando se confirma un pedido
 * (ver AgentOrchestrator.processOrderSwarm — equivalente a asyncio.gather).
 *
 * Escucha: pedido.confirmado
 * Publica: inventario.actualizado, resultado.agente
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { AgentBase } from './core/AgentBase.js'
import { eventBus, EVENT_TYPES } from './core/EventBus.js'
import { sharedMemory, MEMORY_KEYS } from './core/SharedMemory.js'
import { complete } from './core/llmClient.js'

const SYSTEM_PROMPT = `
Eres el Agente de Inventario del Marketplace Golden Bears.

Reglas de negocio:
- Si el stock llega a 0, marcar producto como AGOTADO.
- Si quedan menos de 5 unidades, generar alerta de stock bajo.
- Nunca permitir stock negativo.
`.trim()

const LOW_STOCK_THRESHOLD = 5

class InventoryAgentClass extends AgentBase {
  constructor() {
    super('InventoryAgent', SYSTEM_PROMPT, ['stock_api', 'bd_inventario', 'alertas_reabastecimiento'])
    this._stock = new Map()

    this.registerTool('actualizar_stock', 'Descuenta stock tras confirmar un pedido', this._actualizarStock)
  }

  setCatalog(catalog) {
    for (const p of catalog || []) {
      if (!this._stock.has(p.id)) this._stock.set(p.id, p.stock ?? 0)
    }
  }

  getStock(productoId) {
    return this._stock.get(productoId) ?? 0
  }

  getAllStock() {
    return Object.fromEntries(this._stock)
  }

  async _actualizarStock({ ordenId, items = [] }, correlationId) {
    const itemsActualizados = []
    const conflictos = []
    const alertasStock = []
    let exito = true

    for (const item of items) {
      const prodId = item.producto_id
      const cantidad = item.cantidad || 1

      if (!this._stock.has(prodId)) {
        conflictos.push({ productoId: prodId, razon: 'Producto no encontrado en inventario' })
        exito = false
        continue
      }

      const stockActual = this._stock.get(prodId)
      if (stockActual < cantidad) {
        conflictos.push({ productoId: prodId, razon: `Stock insuficiente: ${stockActual} < ${cantidad}` })
        exito = false
        continue
      }

      const nuevoStock = stockActual - cantidad
      this._stock.set(prodId, nuevoStock)

      itemsActualizados.push({ productoId: prodId, nombre: item.nombre || prodId, cantidadVendida: cantidad, stockAnterior: stockActual, stockNuevo: nuevoStock })

      if (nuevoStock === 0) {
        alertasStock.push({ productoId: prodId, nivel: 'AGOTADO' })
      } else if (nuevoStock < LOW_STOCK_THRESHOLD) {
        alertasStock.push({ productoId: prodId, nivel: 'STOCK_BAJO', cantidad: nuevoStock })
      }
    }

    const analisis = await complete({
      system: this.systemPrompt,
      prompt: `Stock actualizado para ${itemsActualizados.length} productos. Conflictos: ${conflictos.length}. Alertas: ${alertasStock.length}. Genera un resumen en 1 frase.`,
      mockFallback: () => {
        let msg = `Stock actualizado para ${itemsActualizados.length} productos.`
        if (alertasStock.length) msg += ` ${alertasStock.length} alerta(s) de stock bajo generadas.`
        return msg
      },
    })

    const resultPayload = { ordenId, itemsActualizados, exito, conflictos, alertasStock, analisisIA: analisis }

    sharedMemory.set(MEMORY_KEYS.STOCK_ALERTS, alertasStock, this.name)

    eventBus.publish(EVENT_TYPES.INVENTORY_UPDATED, resultPayload, this.name, correlationId)
    eventBus.publish(EVENT_TYPES.AGENT_RESULT, { agente: this.name, resultado: resultPayload, exito }, this.name, correlationId)

    return resultPayload
  }
}

export const inventoryAgent = new InventoryAgentClass()
export default inventoryAgent
