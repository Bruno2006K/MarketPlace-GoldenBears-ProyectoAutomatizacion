/**
 * src/context/AgentContext.jsx
 * Conecta el AgentOrchestrator (sistema multiagente) con React. Migrado del
 * mismo patrón de Pardos Chicken: inyecta el catálogo en los agentes al montar
 * y expone las acciones de alto nivel (búsqueda, carrito, checkout) a la UI.
 */
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { orchestrator } from '../agents/core/AgentOrchestrator.js'
import { eventBus } from '../agents/core/EventBus.js'
import { useCatalog } from './CatalogContext.jsx'

const AgentContext = createContext(null)

export function AgentProvider({ children }) {
  const { productos, loading: catalogLoading, actualizarStockLocal } = useCatalog()
  const [systemStatus, setSystemStatus] = useState(() => orchestrator.getSystemStatus())
  const [eventLog, setEventLog] = useState([])
  const [ordersStore, setOrdersStore] = useState(() => orchestrator.getOrdersStore())
  const [stockAlerts, setStockAlerts] = useState([])
  const catalogInjected = useRef(false)

  // Inyecta el catálogo en los agentes en cuanto está disponible.
  useEffect(() => {
    if (!catalogLoading && productos.length && !catalogInjected.current) {
      orchestrator.setCatalog(productos)
      catalogInjected.current = true
      setSystemStatus(orchestrator.getSystemStatus())
    }
  }, [catalogLoading, productos])

  // Suscripción "wildcard" para el panel de monitoreo en tiempo real.
  useEffect(() => {
    const unsub = eventBus.onEvent((msg) => {
      setEventLog((prev) => [...prev.slice(-99), msg])
      setSystemStatus(orchestrator.getSystemStatus())
    })
    return unsub
  }, [])

  // Cuando el inventario cambia (tras un checkout), refleja el nuevo stock en el catálogo visible.
  useEffect(() => {
    const unsub = eventBus.subscribe('inventario.actualizado', (msg) => {
      for (const item of msg.payload.itemsActualizados || []) {
        actualizarStockLocal(item.productoId, item.stockNuevo)
      }
      if (msg.payload.alertasStock?.length) {
        setStockAlerts((prev) => [...prev, ...msg.payload.alertasStock])
      }
    })
    return unsub
  }, [actualizarStockLocal])

  // Refresca el listado de órdenes del vendedor cuando se confirma o despacha un pedido.
  useEffect(() => {
    const unsub1 = eventBus.subscribe('pedido.confirmado', () => setOrdersStore(orchestrator.getOrdersStore()))
    const unsub2 = eventBus.subscribe('pedido.despachado', () => setOrdersStore(orchestrator.getOrdersStore()))
    return () => { unsub1(); unsub2() }
  }, [])

  const [ticketsStore, setTicketsStore] = useState(() => orchestrator.getTicketsStore())

  // Refresca el listado de tickets cuando se procesa o resuelve uno.
  useEffect(() => {
    const unsub1 = eventBus.subscribe('reclamo.creado', () => setTicketsStore(orchestrator.getTicketsStore()))
    const unsub2 = eventBus.subscribe('reclamo.procesado', () => setTicketsStore(orchestrator.getTicketsStore()))
    return () => { unsub1(); unsub2() }
  }, [])

  const buscarProductos = useCallback((query, filtros = {}) => orchestrator.iniciarBusqueda({ query, filtros }), [])
  const validarCarrito = useCallback((usuarioId, items) => orchestrator.actualizarCarrito({ usuarioId, items }), [])
  const procesarCheckout = useCallback((params) => orchestrator.procesarCheckout(params), [])
  const despacharPedido = useCallback((ordenId, guia) => orchestrator.despacharPedido(ordenId, guia), [])
  const procesarReclamo = useCallback((params) => orchestrator.procesarReclamo(params), [])
  const resolverTicketManualmente = useCallback((ticketId, resolucion) => {
    const res = orchestrator.resolverTicketManualmente(ticketId, resolucion)
    setTicketsStore(orchestrator.getTicketsStore())
    return res
  }, [])

  const value = {
    orchestrator,
    systemStatus,
    eventLog,
    ordersStore,
    stockAlerts,
    ticketsStore,
    buscarProductos,
    validarCarrito,
    procesarCheckout,
    despacharPedido,
    procesarReclamo,
    resolverTicketManualmente,
    refreshStatus: () => setSystemStatus(orchestrator.getSystemStatus()),
  }

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}

export function useAgents() {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error('useAgents debe usarse dentro de <AgentProvider>')
  return ctx
}
