/**
 * tests/event-bus.test.mjs
 * Verifica validación de schema MCP y trazabilidad por correlationId.
 */
import assert from 'node:assert/strict'
import { eventBus, EVENT_TYPES } from '../src/agents/core/EventBus.js'

export async function run() {
  eventBus.clearHistory()

  // 1. Evento válido se publica y queda en el historial
  const msg = eventBus.publish(EVENT_TYPES.SEARCH_STARTED, { query: 'zapatillas', usuarioId: 'USR-001' }, 'TestAgent', 'corr-1')
  assert.ok(msg, 'El evento válido debería publicarse')
  assert.equal(msg.correlationId, 'corr-1')
  assert.equal(eventBus.getHistory(1)[0].type, EVENT_TYPES.SEARCH_STARTED)

  // 2. Evento con payload incompleto es RECHAZADO (falta usuarioId)
  const rechazado = eventBus.publish(EVENT_TYPES.SEARCH_STARTED, { query: 'sin usuario' }, 'TestAgent')
  assert.equal(rechazado, null, 'El evento sin campos requeridos debe ser rechazado')

  // 3. Métricas reflejan el rechazo
  const metrics = eventBus.getMetrics()
  assert.ok(metrics.validationErrors >= 1, 'Debe registrar al menos 1 error de validación')

  console.log('✅ event-bus.test.mjs OK')
}
