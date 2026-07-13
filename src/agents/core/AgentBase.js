/**
 * src/agents/core/AgentBase.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Clase base para todos los agentes del sistema multiagente.
 * Migrada 1:1 desde la arquitectura de Pardos Chicken.
 *
 * Cada agente tiene:
 *   - systemPrompt: rol, responsabilidades y reglas de negocio del agente
 *   - tools: herramientas (funciones) que el agente puede ejecutar
 *   - memory: memoria propia del agente (conversationHistory)
 *   - metrics: latencia, tasa de éxito, tokens estimados
 *
 * Ciclo: input → validate → execute tool → log → publish event → return result
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eventBus } from './EventBus.js'
import { sharedMemory } from './SharedMemory.js'
import { EVENT_TYPES } from './EventBus.js'

export class AgentBase {
  constructor(name, systemPrompt, capabilities = []) {
    this.name         = name
    this.systemPrompt = systemPrompt
    this.capabilities = capabilities
    this.isActive     = false

    this._tools = new Map()
    this._conversationHistory = []
    this._metrics = {
      totalCalls: 0, successCalls: 0, failedCalls: 0, totalLatency: 0,
      lastCallAt: null, lastError: null, totalTokens: 0,
    }
  }

  registerTool(toolName, description, handler) {
    this._tools.set(toolName, { description, handler: handler.bind(this) })
  }

  getTools() {
    return [...this._tools.entries()].map(([name, tool]) => ({ name, description: tool.description }))
  }

  async execute(toolName, params = {}, correlationId = null) {
    const startTime = Date.now()
    this._metrics.totalCalls++
    this._metrics.lastCallAt = new Date().toISOString()
    this.isActive = true

    eventBus.publish(EVENT_TYPES.AGENT_STARTED, { agentName: this.name, tool: toolName, params }, this.name, correlationId)

    try {
      const tool = this._tools.get(toolName)
      if (!tool) throw new Error(`Herramienta "${toolName}" no encontrada en agente "${this.name}"`)

      this._addToHistory('user', `Ejecutar: ${toolName}`, params)

      const result = await tool.handler(params, correlationId)

      const latency = Date.now() - startTime
      this._metrics.successCalls++
      this._metrics.totalLatency += latency

      const promptChars = (this.systemPrompt || '').length + JSON.stringify(params || {}).length
      const completionChars = result ? JSON.stringify(result).length : 0
      this._metrics.totalTokens = (this._metrics.totalTokens || 0) + Math.ceil((promptChars + completionChars) / 4)

      this._addToHistory('assistant', `Resultado de ${toolName}`, result)

      eventBus.publish(EVENT_TYPES.AGENT_COMPLETED, { agentName: this.name, tool: toolName, latency, success: true }, this.name, correlationId)

      this.isActive = false
      return { success: true, result, latency, agentName: this.name }
    } catch (error) {
      const latency = Date.now() - startTime
      this._metrics.failedCalls++
      this._metrics.lastError = error.message

      const promptChars = (this.systemPrompt || '').length + JSON.stringify(params || {}).length
      this._metrics.totalTokens = (this._metrics.totalTokens || 0) + Math.ceil((promptChars + error.message.length) / 4)

      eventBus.publish(EVENT_TYPES.AGENT_ERROR, { agentName: this.name, tool: toolName, error: error.message, latency }, this.name, correlationId)

      this.isActive = false
      return { success: false, result: null, latency, error: error.message, agentName: this.name }
    }
  }

  _addToHistory(role, content, data = null) {
    const entry = { role, content, data, timestamp: new Date().toISOString(), agentName: this.name }
    this._conversationHistory.push(entry)

    try {
      const storageKey = `agent_history_${this.name}`
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]')
      stored.push(entry)
      localStorage.setItem(storageKey, JSON.stringify(stored.slice(-50)))
    } catch { /* localStorage puede no estar disponible (SSR/tests) */ }

    if (this._conversationHistory.length > 100) this._conversationHistory.shift()
  }

  _loadHistoryFromStorage() {
    try {
      const storageKey = `agent_history_${this.name}`
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]')
      if (stored.length > 0) this._conversationHistory = stored
    } catch { /* silently fail */ }
  }

  clearHistory() {
    this._conversationHistory = []
    try { localStorage.removeItem(`agent_history_${this.name}`) } catch { /* noop */ }
  }

  getConversationHistory(limit = 20) {
    return this._conversationHistory.slice(-limit)
  }

  getMetrics() {
    const { totalCalls, successCalls, failedCalls, totalLatency, lastCallAt, lastError, totalTokens } = this._metrics
    return {
      agentName: this.name,
      capabilities: this.capabilities,
      totalCalls, successCalls, failedCalls,
      successRate: totalCalls > 0 ? ((successCalls / totalCalls) * 100).toFixed(1) : '100.0',
      avgLatency: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
      totalLatency, lastCallAt, lastError,
      isActive: this.isActive,
      toolCount: this._tools.size,
      historyEntries: this._conversationHistory.length,
      totalTokens: totalTokens || 0,
    }
  }

  get memory() { return sharedMemory }
  get bus() { return eventBus }

  log(level, message, data = null) {
    const entry = { level, message, agentName: this.name, timestamp: new Date().toISOString(), data }
    if (level === 'error') console.error(`[${this.name}]`, message, data)
    else if (level === 'warn') console.warn(`[${this.name}]`, message, data)
    else console.log(`[${this.name}]`, message, data)
    return entry
  }
}

export default AgentBase
