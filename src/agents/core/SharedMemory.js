/**
 * src/agents/core/SharedMemory.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Memoria compartida del sistema multiagente — Estado global explícito.
 * Migrada 1:1 desde Pardos Chicken. Implementa:
 *   - Estado centralizado accesible por todos los agentes
 *   - Versionado de cada clave para detección de conflictos
 *   - Resolución de conflictos: last-write-wins + prioridad por agente
 *     (equivalente a AGENT_PRIORITY de core/shared_state.py del backend
 *     Python original — el Orquestador siempre gana, Notificaciones nunca).
 *   - Aislamiento de memoria por agente (anti-alucinación)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const MEMORY_KEYS = {
  // Sesión / búsqueda
  SESSION:            'session',
  LAST_QUERY:         'busqueda_ultima_query',
  SEARCH_RESULTS:     'busqueda_resultados',
  RECOMMENDATIONS:    'busqueda_recomendaciones',

  // Carrito y pago
  CART:               'carrito',
  CART_VALIDATED:      'carrito_validado',
  PAYMENT:            'pago',

  // Pedidos
  ORDER:              'pedido',
  ORDERS_STORE:        'ordenes_vendedor',

  // Inventario
  STOCK:              'inventario_stock',
  STOCK_ALERTS:        'inventario_alertas',

  // Notificaciones
  LAST_NOTIFICATION:  'notificaciones_ultima',
  NOTIFICATIONS_TOTAL: 'notificaciones_total',

  // Soporte / Tickets
  TICKET:             'ticket',
  TICKETS_STORE:      'reclamos_soporte',

  // Métricas del sistema
  AGENT_METRICS:      'agent_metrics',
}

/** Prioridad de resolución de conflictos — mayor número gana (espejo de AGENT_PRIORITY en Python). */
export const AGENT_PRIORITY = {
  OrchestratorAgent:  10,
  OrderAgent:          8,
  CartPaymentAgent:    7,
  InventoryAgent:      6,
  ResolutionAgent:     5,
  SearchAgent:         3,
  NotificationAgent:   2,
}

/** Aislamiento de memoria: qué claves puede leer/escribir cada agente. */
export const AGENT_PERMISSIONS = {
  SearchAgent:         { write: ['busqueda_ultima_query', 'busqueda_resultados', 'busqueda_recomendaciones'], read: ['busqueda_ultima_query', 'busqueda_resultados', 'busqueda_recomendaciones'] },
  CartPaymentAgent:    { write: ['carrito', 'carrito_validado', 'pago'], read: ['carrito', 'carrito_validado', 'pago'] },
  OrderAgent:          { write: ['pedido', 'ordenes_vendedor'], read: ['pedido', 'ordenes_vendedor', 'pago'] },
  InventoryAgent:      { write: ['inventario_stock', 'inventario_alertas'], read: ['inventario_stock', 'inventario_alertas', 'pedido'] },
  NotificationAgent:   { write: ['notificaciones_ultima', 'notificaciones_total'], read: ['pedido', 'inventario_alertas'] },
  ResolutionAgent:     { write: ['ticket', 'reclamos_soporte'], read: ['ticket', 'reclamos_soporte', 'ordenes_vendedor'] },
}

class SharedMemoryClass {
  constructor() {
    this._store = new Map()
    this._operationLog = []
    this._reads = 0
    this._writes = 0
    this._conflicts = 0
    this._resolved = 0
  }

  set(key, value, agentName, expectedVersion = null) {
    this._checkPermission(agentName, key, 'write')
    const existing = this._store.get(key)
    const now = new Date().toISOString()

    if (expectedVersion !== null && existing && existing.version !== expectedVersion) {
      this._conflicts++
      const myPriority = AGENT_PRIORITY[agentName] ?? 1
      const otherPriority = AGENT_PRIORITY[existing.updatedBy] ?? 1

      this._operationLog.push({
        op: 'CONFLICT_DETECTED', key, expectedVersion, actualVersion: existing.version,
        attemptedBy: agentName, lastUpdatedBy: existing.updatedBy, timestamp: now,
      })

      if (myPriority < otherPriority) {
        // El agente de menor prioridad cede — no sobreescribe.
        this._operationLog.push({ op: 'CONFLICT_YIELDED', winner: existing.updatedBy, loser: agentName, timestamp: now })
        return { success: false, version: existing.version, conflict: { winner: existing.updatedBy, loser: agentName } }
      }

      this._resolved++
      this._operationLog.push({ op: 'CONFLICT_RESOLVED', strategy: 'priority+last-write-wins', winner: agentName, timestamp: now })
    }

    const newVersion = (existing?.version || 0) + 1
    this._store.set(key, { value, version: newVersion, updatedAt: now, updatedBy: agentName })

    this._writes++
    this._operationLog.push({ op: 'WRITE', key, version: newVersion, agentName, timestamp: now })

    return { success: true, version: newVersion }
  }

  get(key, defaultValue = null) {
    this._reads++
    const entry = this._store.get(key)
    if (!entry) return { value: defaultValue, version: 0, updatedAt: null, updatedBy: null }
    return { ...entry }
  }

  getValue(key, defaultValue = null) {
    return this.get(key, defaultValue).value ?? defaultValue
  }

  update(key, patch, agentName) {
    const existing = this.getValue(key, {})
    const merged = Array.isArray(existing) ? [...existing, ...patch] : { ...existing, ...patch }
    return this.set(key, merged, agentName)
  }

  _checkPermission(agentName, key, op) {
    if (!agentName || !AGENT_PERMISSIONS[agentName]) return
    const perms = AGENT_PERMISSIONS[agentName]
    const allowed = op === 'write' ? perms.write : perms.read
    if (allowed.length > 0 && !allowed.includes(key)) {
      console.warn(`[SharedMemory] AISLAMIENTO: ${agentName} intentó ${op} en "${key}" sin permiso. Claves permitidas: [${allowed.join(', ')}]`)
    }
  }

  getMetrics() {
    return {
      totalKeys:   this._store.size,
      totalReads:  this._reads,
      totalWrites: this._writes,
      conflicts:   this._conflicts,
      resolved:    this._resolved,
      resolutionRate: this._conflicts > 0 ? ((this._resolved / this._conflicts) * 100).toFixed(1) : '100.0',
    }
  }

  getOperationLog(limit = 30) {
    return this._operationLog.slice(-limit)
  }

  snapshot() {
    const result = {}
    this._store.forEach((entry, key) => {
      result[key] = { version: entry.version, updatedAt: entry.updatedAt, updatedBy: entry.updatedBy }
    })
    return result
  }
}

export const sharedMemory = new SharedMemoryClass()
export default sharedMemory
