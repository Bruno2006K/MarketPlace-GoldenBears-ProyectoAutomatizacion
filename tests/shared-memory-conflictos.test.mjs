/**
 * tests/shared-memory-conflictos.test.mjs
 * Verifica versionado y resolución de conflictos por prioridad de agente
 * (equivalente a AGENT_PRIORITY / _resolve_conflict en shared_state.py).
 */
import assert from 'node:assert/strict'
import { sharedMemory } from '../src/agents/core/SharedMemory.js'

export async function run() {
  const key = 'test_conflict_key'

  // Escritura inicial por un agente de baja prioridad
  const r1 = sharedMemory.set(key, { estado: 'v1' }, 'NotificationAgent')
  assert.equal(r1.success, true)
  assert.equal(r1.version, 1)

  // Un agente de mayor prioridad escribe con la versión esperada correcta → gana sin conflicto
  const r2 = sharedMemory.set(key, { estado: 'v2' }, 'OrderAgent', 1)
  assert.equal(r2.success, true)
  assert.equal(r2.version, 2)

  // Un agente de MENOR prioridad intenta escribir con versión desactualizada → debe CEDER
  const r3 = sharedMemory.set(key, { estado: 'v3_baja_prioridad' }, 'NotificationAgent', 1)
  assert.equal(r3.success, false, 'NotificationAgent (prioridad baja) debe ceder ante OrderAgent')
  assert.equal(sharedMemory.getValue(key).estado, 'v2', 'El valor no debe cambiar tras ceder')

  // Un agente de MAYOR prioridad (Orchestrator) siempre gana
  const r4 = sharedMemory.set(key, { estado: 'v4_orquestador' }, 'OrchestratorAgent', 1)
  assert.equal(r4.success, true, 'OrchestratorAgent (máxima prioridad) debe ganar el conflicto')
  assert.equal(sharedMemory.getValue(key).estado, 'v4_orquestador')

  console.log('✅ shared-memory-conflictos.test.mjs OK')
}
