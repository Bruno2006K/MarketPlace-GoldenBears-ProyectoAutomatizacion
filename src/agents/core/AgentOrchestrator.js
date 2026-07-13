/**
 * src/agents/core/AgentOrchestrator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquestador Central — Núcleo del sistema multiagente (Topología Híbrida:
 * Estrella + Cadena). Migrado de core/antigravity.py (AgentGraph +
 * SwarmOrchestrator) + agents/orchestrator.py del backend Python original.
 *
 *   CLIENTE → ORQUESTADOR → EVENT BUS (MCP) → AGENTES → SERVICIOS EXTERNOS
 *
 * Flujo de compra (cadena secuencial, con un tramo paralelo — SWARM):
 *
 *   1. iniciarBusqueda        → SearchAgent
 *   2. actualizarCarrito      → CartPaymentAgent.validar_carrito
 *   3. procesarCheckout       → CartPaymentAgent.procesar_pago
 *                             → OrderAgent.crear_orden (si el pago fue exitoso)
 *                             → SWARM: InventoryAgent + NotificationAgent
 *                               EN PARALELO (Promise.all), igual que
 *                               asyncio.gather en el backend Python original.
 *
 * El correlationId se propaga a lo largo de todo el flujo para poder trazar
 * en el panel de monitoreo (SwarmMonitorPage) que todos esos eventos
 * pertenecen a la misma compra.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { searchAgent } from '../SearchAgent.js'
import { cartPaymentAgent } from '../CartPaymentAgent.js'
import { orderAgent } from '../OrderAgent.js'
import { inventoryAgent } from '../InventoryAgent.js'
import { notificationAgent } from '../NotificationAgent.js'
import { eventBus, EVENT_TYPES } from './EventBus.js'
import { sharedMemory, MEMORY_KEYS } from './SharedMemory.js'

/** AgentRegistry — Service Locator para descubrir agentes en tiempo de ejecución. */
class AgentRegistry {
  constructor() {
    this._agents = new Map()
  }
  register(agent) {
    this._agents.set(agent.name, agent)
    console.log(`[AgentRegistry] Agente registrado: ${agent.name}`)
  }
  get(name) { return this._agents.get(name) || null }
  getAll() { return [...this._agents.values()] }
  getCapabilities() {
    return [...this._agents.entries()].map(([name, agent]) => ({
      name, capabilities: agent.capabilities, tools: agent.getTools(), isActive: agent.isActive,
    }))
  }
}

class AgentOrchestratorClass {
  constructor() {
    this.name = 'OrchestratorAgent'
    this.topology = 'hybrid-star-chain'
    this.registry = new AgentRegistry()

    this._metrics = {
      totalOrchestrations: 0,
      swarmExecutions: 0,
      parallelTasksTotal: 0,
      startedAt: new Date().toISOString(),
    }

    this._initialize()
  }

  _initialize() {
    this.registry.register(searchAgent)
    this.registry.register(cartPaymentAgent)
    this.registry.register(orderAgent)
    this.registry.register(inventoryAgent)
    this.registry.register(notificationAgent)

    sharedMemory.set(MEMORY_KEYS.AGENT_METRICS, {
      initialized: true, topology: this.topology, agentCount: this.registry.getAll().length, startedAt: new Date().toISOString(),
    }, this.name)

    eventBus.subscribe(EVENT_TYPES.AGENT_ERROR, (msg) => {
      console.error(`[Orchestrator] Error en agente ${msg.payload.agentName}:`, msg.payload.error)
    })

    console.log(`[Orchestrator] Sistema multiagente inicializado — ${this.registry.getAll().length} agentes registrados`)
  }

  /**
   * setCatalog — Propaga el catálogo (desde CatalogContext/Supabase) a los
   * agentes que lo necesitan. Se llama una vez al montar AgentContext.
   */
  setCatalog(catalog) {
    searchAgent.setCatalog(catalog)
    cartPaymentAgent.setCatalog(catalog)
    inventoryAgent.setCatalog(catalog)
  }

  // ── Flujo 1: Búsqueda ─────────────────────────────────────────────────────
  async iniciarBusqueda({ query, usuarioId = 'USR-001', filtros = {} }) {
    this._metrics.totalOrchestrations++
    const correlationId = `flow_search_${Date.now()}`
    return searchAgent.execute('buscar_productos', { query, usuarioId, filtros }, correlationId)
  }

  // ── Flujo 2: Carrito ──────────────────────────────────────────────────────
  async actualizarCarrito({ usuarioId = 'USR-001', items }) {
    this._metrics.totalOrchestrations++
    const correlationId = `flow_cart_${Date.now()}`
    return cartPaymentAgent.execute('validar_carrito', { usuarioId, items }, correlationId)
  }

  // ── Flujo 3 (SWARM): Checkout completo ───────────────────────────────────
  /**
   * procesarCheckout — Orquesta el flujo completo: pago → pedido → SWARM
   * (inventario + notificaciones en paralelo).
   *
   * Equivalente exacto de:
   *   Python: carrito_pago._procesar_pago → pedidos.process → (inventario +
   *           notificaciones vía asyncio.gather)
   */
  async procesarCheckout({ usuarioId = 'USR-001', items, total, metodoPago = 'tarjeta' }) {
    this._metrics.totalOrchestrations++
    const correlationId = `flow_checkout_${Date.now()}`

    // Paso 1: Pago (secuencial, es prerrequisito de todo lo demás)
    const pagoResult = await cartPaymentAgent.execute('procesar_pago', { usuarioId, total, metodoPago, items }, correlationId)
    const pago = pagoResult.result

    if (!pago?.exitoso) {
      return { exito: false, etapa: 'pago', pago, mensaje: 'El pago fue rechazado. Intenta nuevamente.', correlationId }
    }

    // Paso 2: Crear orden (secuencial, depende del pago)
    const ordenResult = await orderAgent.execute('crear_orden', {
      usuarioId, total: pago.total, items: pago.items || items, transaccionId: pago.transaccionId, exitoso: pago.exitoso,
    }, correlationId)
    const orden = ordenResult.result

    if (!orden?.creado) {
      return { exito: false, etapa: 'pedido', pago, mensaje: 'No se pudo confirmar el pedido.', correlationId }
    }

    // Paso 3 (SWARM): Inventario + Notificaciones EN PARALELO — Promise.all()
    this._metrics.swarmExecutions++
    this._metrics.parallelTasksTotal += 2
    console.log('[Orchestrator] 🌀 SWARM: pedido.confirmado — InventoryAgent + NotificationAgent en paralelo')

    const [inventarioResult, notifResult] = await Promise.all([
      inventoryAgent.execute('actualizar_stock', { ordenId: orden.ordenId, items: orden.items }, correlationId),
      notificationAgent.execute('notificar_pedido', {
        ordenId: orden.ordenId, usuarioId, total: orden.total, facturaId: orden.facturaId,
        fechaEntregaEstimada: orden.fechaEntregaEstimada, items: orden.items,
      }, correlationId),
    ])

    // Si el inventario generó alertas de stock bajo, dispara notificación al admin
    // (mismo evento adicional que en Python: notificaciones también escucha inventario.actualizado).
    const alertas = inventarioResult.result?.alertasStock || []
    if (alertas.length > 0) {
      notificationAgent.execute('notificar_alertas_stock', { alertasStock: alertas }, correlationId)
    }

    return {
      exito: true,
      swarmType: 'checkout_completo',
      agentsInvolved: ['CartPaymentAgent', 'OrderAgent', 'InventoryAgent', 'NotificationAgent'],
      correlationId,
      pago, pedido: orden,
      inventario: inventarioResult.result,
      notificaciones: notifResult.result,
      mensaje: `Pedido #${orden.ordenId} confirmado! Factura ${orden.facturaId}.`,
    }
  }

  // ── Panel Vendedor ─────────────────────────────────────────────────────────
  despacharPedido(ordenId, numeroGuia) {
    return orderAgent.despacharOrden(ordenId, numeroGuia)
  }

  getOrdersStore() { return orderAgent.getOrdersStore() }
  getStock(productoId) { return inventoryAgent.getStock(productoId) }
  getAllStock() { return inventoryAgent.getAllStock() }

  // ── Métricas y estado del sistema ─────────────────────────────────────────
  getSystemStatus() {
    const agents = this.registry.getAll().map((agent) => ({
      ...agent.getMetrics(), tools: agent.getTools(), isActive: agent.isActive,
    }))
    const grandTotalTokens = agents.reduce((sum, a) => sum + (a.totalTokens || 0), 0)

    return {
      orchestrator: {
        name: this.name, topology: this.topology, ...this._metrics,
        uptime: Math.round((Date.now() - new Date(this._metrics.startedAt).getTime()) / 1000),
        totalTokens: grandTotalTokens,
      },
      agents,
      eventBus: eventBus.getMetrics(),
      sharedMemory: sharedMemory.getMetrics(),
      agentCount: agents.length,
      activeAgents: agents.filter((a) => a.isActive).length,
      totalSwarms: this._metrics.swarmExecutions,
    }
  }

  getEventHistory(limit = 30) { return eventBus.getHistory(limit) }
  getAgentHistory(agentName, limit = 20) {
    const agent = this.registry.get(agentName)
    return agent?.getConversationHistory(limit) || []
  }
}

export const orchestrator = new AgentOrchestratorClass()
export default orchestrator
