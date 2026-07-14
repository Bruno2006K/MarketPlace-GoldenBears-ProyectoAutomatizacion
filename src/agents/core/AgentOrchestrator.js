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
import { resolutionAgent } from '../ResolutionAgent.js'
import { eventBus, EVENT_TYPES } from './EventBus.js'
import { sharedMemory, MEMORY_KEYS } from './SharedMemory.js'
import { checkoutGraph } from './graphs/checkoutGraph.js'
import { resolutionGraph } from './graphs/resolutionGraph.js'
import { resolutionChatGraph } from './graphs/resolutionChatGraph.js'

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
   * procesarReclamo — Ejecuta resolutionGraph.js (StateGraph real con arista
   * condicional + checkpointer por correlationId). El ticket, con su
   * propuesta de resolución, se persiste en el nodo "analizar"; si
   * needsHumanReview es true, el grafo pasa por el nodo "esperarRevisionHumana"
   * (pausa HITL a nivel de aplicación — ver nota en resolutionGraph.js sobre
   * por qué no se usa interrupt() de LangGraph.js en un sistema client-side).
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

    return { success: true, result: finalState.ticket, agentName: resolutionAgent.name }
  }

  /** resolverTicketManualmente — Aplica la decisión humana al ticket (HITL). */
  resolverTicketManualmente(ticketId, resolucionAprobada) {
    return resolutionAgent.resolverTicketManualmente(ticketId, resolucionAprobada)
  }

  /**
   * enviarMensajeChatSoporte — Un turno del chat conversacional de soporte
   * (resolutionChatGraph.js). thread_id = conversationId, estable durante
   * toda la conversación (lo genera la UI una vez al abrir el chat), así el
   * checkpointer recuerda la fase entre mensajes.
   */
  async enviarMensajeChatSoporte({ conversationId, usuarioId = 'USR-001', ordenIdHint = null, mensaje }) {
    this._metrics.totalOrchestrations++

    const finalState = await resolutionChatGraph.invoke(
      { conversationId, usuarioId, ordenIdHint, ultimoMensaje: mensaje },
      { configurable: { thread_id: conversationId } },
    )

    const ultimoMensajeAgente = [...finalState.historial].reverse().find((m) => m.role === 'agente')

    return {
      respuesta: ultimoMensajeAgente?.content || '',
      fase: finalState.fase,
      needsHumanReview: finalState.needsHumanReview,
      ticketId: finalState.ticketId,
      historial: finalState.historial,
    }
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
