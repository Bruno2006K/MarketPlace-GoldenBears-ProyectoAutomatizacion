/**
 * src/context/CatalogContext.jsx
 * Estado del catálogo de productos. Intenta cargar desde Supabase; si no hay
 * credenciales o falla, cae a productsSeed.js (igual que mock_data.py en el
 * backend Python original — el sistema siempre funciona, con o sin BD real).
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../domain/supabase.js'
import { PRODUCTS_SEED } from '../data/seeds/productsSeed.js'

const CatalogContext = createContext(null)

export function CatalogProvider({ children }) {
  const [productos, setProductos] = useState([])
  const [loading, setLoading] = useState(true)
  const [usandoSupabase, setUsandoSupabase] = useState(false)

  const cargarCatalogo = useCallback(async () => {
    setLoading(true)
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('productos').select('*').order('id')
      if (!error && data?.length) {
        setProductos(data)
        setUsandoSupabase(true)
        setLoading(false)
        return
      }
      console.warn('[CatalogContext] Supabase sin datos o con error, usando seed local:', error?.message)
    }
    setProductos(PRODUCTS_SEED)
    setUsandoSupabase(false)
    setLoading(false)
  }, [])

  // cargarCatalogo es async y hace los setState tras el await a Supabase, no
  // sincrónicamente dentro del efecto — es el patrón estándar de fetch-on-mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargarCatalogo() }, [cargarCatalogo])

  /** actualizarStockLocal — refleja en la UI el stock que gestiona InventoryAgent. */
  const actualizarStockLocal = useCallback((productoId, nuevoStock) => {
    setProductos((prev) => prev.map((p) => (p.id === productoId ? { ...p, stock: nuevoStock } : p)))
  }, [])

  const value = { productos, loading, usandoSupabase, recargar: cargarCatalogo, actualizarStockLocal }
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog() {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog debe usarse dentro de <CatalogProvider>')
  return ctx
}
