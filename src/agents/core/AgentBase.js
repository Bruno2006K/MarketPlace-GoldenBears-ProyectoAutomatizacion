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
 *
 * Optimización de tokens (guia_automatizacion.md, sección 7 — "Prompt
 * Summarization"): cada 5 entradas del historial, se compacta a un resumen
 * consolidado + las últimas 3 entradas completas, evitando que el contexto
 * crezca sin límite en llamadas futuras al LLM.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { eventBus } from './EventBus.js'
import { sharedMemory } from './SharedMemory.js'
import { EVENT_TYPES } from './EventBus.js'
import { complete, MODELOS } from './llmClient.js'

const COMPACT_EVERY = 5
const KEEP_RECENT = 3

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

    // Fire-and-forget: no bloquea el flujo del agente ni sus tests.
    this._compactHistoryIfNeeded().catch(() => { /* la compactación es best-effort */ })
  }

  /** _compactHistoryIfNeeded — resume el historial cada COMPACT_EVERY entradas. */
  async _compactHistoryIfNeeded() {
    if (this._compacting) return
    if (this._conversationHistory.length < COMPACT_EVERY) return
    if (this._conversationHistory.length % COMPACT_EVERY !== 0) return

    const antiguos = this._conversationHistory.slice(0, -KEEP_RECENT)
    const recientes = this._conversationHistory.slice(-KEEP_RECENT)
    if (antiguos.length < 2 || antiguos.some((e) => e.esResumen)) return

    this._compacting = true
    try {
      const resumen = await complete({
        system: 'Resume en máximo 2 frases técnicas el siguiente historial de acciones de un agente del sistema multiagente Golden Bears.',
        prompt: antiguos.map((e) => `[${e.role}] ${e.content}`).join('\n'),
        model: MODELOS.GROQ_LLAMA,
        agente: this.name,
        mockFallback: () => `Resumen de ${antiguos.length} acciones previas de ${this.name}.`,
      })

      const resumenEntry = {
        role: 'system', content: 'Resumen consolidado', data: { resumen, mensajesCompactados: antiguos.length },
        timestamp: new Date().toISOString(), agentName: this.name, esResumen: true,
      }
      this._conversationHistory = [resumenEntry, ...recientes]

      try {
        localStorage.setItem(`agent_history_${this.name}`, JSON.stringify(this._conversationHistory))
      } catch { /* localStorage puede no estar disponible (SSR/tests) */ }
    } finally {
      this._compacting = false
    }
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
