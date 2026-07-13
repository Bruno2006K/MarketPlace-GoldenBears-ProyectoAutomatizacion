/**
 * tests/run-all.mjs
 * Ejecuta todos los tests del sistema multiagente. Uso: npm run test:agents
 * Migrado del mismo patrón de runner que Pardos Chicken (tests/run-all.mjs).
 */
import { run as runEventBus } from './event-bus.test.mjs'
import { run as runSharedMemory } from './shared-memory-conflictos.test.mjs'
import { run as runCarritoIGV } from './carrito-pago-igv.test.mjs'
import { run as runInventario } from './inventario-concurrencia.test.mjs'
import { run as runCheckoutSwarm } from './checkout-swarm.test.mjs'

const tests = [
  ['EventBus (validación de schema MCP)', runEventBus],
  ['SharedMemory (resolución de conflictos)', runSharedMemory],
  ['Carrito y Pago (IGV y reglas de negocio)', runCarritoIGV],
  ['Inventario (stock y alertas)', runInventario],
  ['Checkout end-to-end (swarm paralelo)', runCheckoutSwarm],
]

let fallidos = 0

console.log('🐻 Marketplace Golden Bears — Suite de tests del Sistema Multiagente\n')

for (const [nombre, fn] of tests) {
  try {
    await fn()
  } catch (err) {
    fallidos++
    console.error(`❌ ${nombre}:`, err.message)
    console.error(err.stack)
  }
}

console.log(`\n${tests.length - fallidos}/${tests.length} suites pasaron.`)
if (fallidos > 0) process.exit(1)
