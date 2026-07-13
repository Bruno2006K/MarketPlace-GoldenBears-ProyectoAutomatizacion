/**
 * src/context/CartContext.jsx
 * Estado del carrito de compras. Persiste en localStorage (equivalente al
 * historial de conversación persistido en AgentBase — sobrevive recargas).
 */
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'

const CartContext = createContext(null)
const STORAGE_KEY = 'golden_bears_cart'

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    } catch {
      return []
    }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch { /* noop */ }
  }, [items])

  const addItem = useCallback((productoId, cantidad = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.producto_id === productoId)
      if (existing) {
        return prev.map((i) => (i.producto_id === productoId ? { ...i, cantidad: i.cantidad + cantidad } : i))
      }
      return [...prev, { producto_id: productoId, cantidad }]
    })
  }, [])

  const updateQuantity = useCallback((productoId, cantidad) => {
    setItems((prev) => {
      if (cantidad <= 0) return prev.filter((i) => i.producto_id !== productoId)
      return prev.map((i) => (i.producto_id === productoId ? { ...i, cantidad } : i))
    })
  }, [])

  const removeItem = useCallback((productoId) => {
    setItems((prev) => prev.filter((i) => i.producto_id !== productoId))
  }, [])

  const clearCart = useCallback(() => setItems([]), [])

  const totalUnidades = useMemo(() => items.reduce((s, i) => s + i.cantidad, 0), [items])

  const value = { items, addItem, updateQuantity, removeItem, clearCart, totalUnidades }
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart debe usarse dentro de <CartProvider>')
  return ctx
}
