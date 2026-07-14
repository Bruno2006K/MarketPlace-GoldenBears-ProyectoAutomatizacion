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
import { Command } from '@langchain/langgraph'
import { searchAgent } from '../SearchAgent.js'
import { cartPaymentAgent } from '../CartPaymentAgent.js'
import { orderAgent } from '../OrderAgent.js'
import { inventoryAgent } from '../InventoryAgent.js'
import { notificationAgent } from '../NotificationAgent.js'
import { resolutionAgent } from '../ResolutionAgent.js'
import { eventBus, EVENT_TYPES } from './EventBus.js'
import { sharedMemory, MEMORY_KEYS } from './SharedMemory.js'
import { checkoutGraph } from './graphs/checkoutGraph.js'
import { resolutionGraph } from './graphs/resolutionGraph.js'

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
    // ticketId → correlationId (thread_id del resolutionGraph), para poder
    // reanudar la interrupción HITL desde resolverTicketManualmente().
    this._ticketThreads = new Map()

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
    this.registry.register(resolutionAgent)

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
   * (inventario + notificaciones en paralelo), ejecutado como un StateGraph
   * real de LangGraph.js (checkoutGraph.js): aristas condicionales para
   * pago/pedido fallidos, fan-out paralelo real para el swarm, checkpointer
   * por correlationId.
   *
   * Equivalente exacto de:
   *   Python: carrito_pago._procesar_pago → pedidos.process → (inventario +
   *           notificaciones vía asyncio.gather)
   */
  async procesarCheckout({ usuarioId = 'USR-001', items, total, metodoPago = 'tarjeta' }) {
    this._metrics.totalOrchestrations++
    const correlationId = `flow_checkout_${Date.now()}`

    const finalState = await checkoutGraph.invoke(
      { usuarioId, total, items, metodoPago, correlationId },
      { configurable: { thread_id: correlationId } },
    )

    if (!finalState.exito) {
      return { exito: false, etapa: finalState.etapa, pago: finalState.pago, mensaje: finalState.mensaje, correlationId }
    }

    this._metrics.swarmExecutions++
    this._metrics.parallelTasksTotal += 2
    console.log('[Orchestrator] 🌀 SWARM (LangGraph fan-out): pedido.confirmado — InventoryAgent + NotificationAgent en paralelo')

    return {
      exito: true,
      swarmType: 'checkout_completo',
      agentsInvolved: ['CartPaymentAgent', 'OrderAgent', 'InventoryAgent', 'NotificationAgent'],
      correlationId,
      pago: finalState.pago,
      pedido: finalState.orden,
      inventario: finalState.inventario,
      notificaciones: finalState.notificaciones,
      mensaje: finalState.mensaje,
    }
  }

  // ── Panel Vendedor ─────────────────────────────────────────────────────────
  despacharPedido(ordenId, numeroGuia) {
    return orderAgent.despacharOrden(ordenId, numeroGuia)
  }

  getOrdersStore() { return orderAgent.getOrdersStore() }
  getStock(productoId) { return inventoryAgent.getStock(productoId) }
  getAllStock() { return inventoryAgent.getAllStock() }

  // ── Soporte y Reclamos (ResolutionAgent) ──────────────────────────────────
  /**
   * procesarReclamo — Ejecuta resolutionGraph.js: analiza el reclamo y, si la
   * confianza es < 0.8, el grafo se interrumpe (interrupt() real de
   * LangGraph.js) dejando el hilo pausado hasta resolverTicketManualmente().
   * El ticket con su propuesta ya se persiste en el nodo "analizar", así que
   * la interrupción no bloquea la respuesta al cliente — solo marca el hilo
   * del grafo como pendiente de revisión humana.
   */
  async procesarReclamo({ usuarioId = 'USR-001', ordenId = null, textoQueja }) {
    this._metrics.totalOrchestrations++
    const correlationId = `flow_support_${Date.now()}`

    // Publicar evento inicial de reclamo creado
    eventBus.publish(EVENT_TYPES.TICKET_CREATED, { ticketId: `TKT_TEMP_${Date.now()}`, usuarioId, textoQueja }, this.name, correlationId)

    const finalState = await resolutionGraph.invoke(
      { usuarioId, ordenId, textoQueja, correlationId },
      { configurable: { thread_id: correlationId } },
    )

    if (finalState.ticket?.ticketId) {
      this._ticketThreads.set(finalState.ticket.ticketId, correlationId)
    }

    return { success: true, result: finalState.ticket, agentName: resolutionAgent.name }
  }

  /**
   * resolverTicketManualmente — Aplica la decisión humana al ticket y, si el
   * hilo del grafo quedó interrumpido esperando revisión, lo reanuda con
   * `new Command({ resume })` (fire-and-forget: no bloquea la respuesta al
   * staff, solo mantiene el checkpoint de LangGraph consistente).
   */
  resolverTicketManualmente(ticketId, resolucionAprobada) {
    const res = resolutionAgent.resolverTicketManualmente(ticketId, resolucionAprobada)
    const threadId = this._ticketThreads.get(ticketId)
    if (res.exito && threadId) {
      resolutionGraph
        .invoke(new Command({ resume: resolucionAprobada }), { configurable: { thread_id: threadId } })
        .catch((err) => console.warn('[Orchestrator] No se pudo reanudar el grafo de resolución:', err.message))
      this._ticketThreads.delete(ticketId)
    }
    return res
  }

  getTicketsStore() { return resolutionAgent.getTicketsStore() }

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
