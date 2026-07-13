import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, Minus, Plus } from 'lucide-react'
import { useCart } from '../../context/CartContext.jsx'
import { useCatalog } from '../../context/CatalogContext.jsx'
import { useAgents } from '../../context/AgentContext.jsx'
import { formatSoles } from '../../domain/pricing.js'
import Card from '../../components/ui/Card.jsx'
import Button from '../../components/ui/Button.jsx'
import styles from './CartPage.module.css'

export default function CartPage() {
  const { items, updateQuantity, removeItem } = useCart()
  const { productos } = useCatalog()
  const { validarCarrito } = useAgents()
  const navigate = useNavigate()

  const [validacion, setValidacion] = useState(null)
  const [validando, setValidando] = useState(false)

  useEffect(() => {
    let cancelado = false
    async function run() {
      if (!items.length) { setValidacion(null); return }
      setValidando(true)
      const res = await validarCarrito('USR-001', items)
      if (!cancelado && res.success) setValidacion(res.result)
      setValidando(false)
    }
    run()
    return () => { cancelado = true }
  }, [items, validarCarrito])

  const itemsConDatos = items.map((i) => ({
    ...i,
    producto: productos.find((p) => p.id === i.producto_id),
  })).filter((i) => i.producto)

  if (!items.length) {
    return (
      <div className="container">
        <Card className={styles.empty}>
          <p>Tu carrito está vacío.</p>
          <Button variant="primary" onClick={() => navigate('/')}>Ir a la tienda</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className={`container ${styles.wrapper}`}>
      <div className={styles.list}>
        <h1>Tu carrito</h1>
        {itemsConDatos.map(({ producto_id: id, cantidad, producto }) => (
          <Card key={id} className={styles.item}>
            <img src={producto.imagen} alt={producto.nombre} className={styles.itemImg} />
            <div className={styles.itemInfo}>
              <strong>{producto.nombre}</strong>
              <span className={styles.itemBrand}>{producto.marca}</span>
              <span className={styles.itemPrice}>{formatSoles(producto.precio)}</span>
            </div>
            <div className={styles.qtyControls}>
              <button onClick={() => updateQuantity(id, cantidad - 1)}><Minus size={14} /></button>
              <span>{cantidad}</span>
              <button onClick={() => updateQuantity(id, cantidad + 1)} disabled={cantidad >= producto.stock}><Plus size={14} /></button>
            </div>
            <button className={styles.removeBtn} onClick={() => removeItem(id)}><Trash2 size={16} /></button>
          </Card>
        ))}
      </div>

      <Card className={styles.summary}>
        <h2>Resumen</h2>
        {validando && <p className={styles.checking}>CartPaymentAgent validando stock…</p>}
        {validacion && (
          <>
            <Row label="Subtotal" value={formatSoles(validacion.subtotal)} />
            <Row label="IGV (18%)" value={formatSoles(validacion.igv)} />
            <Row label="Total" value={formatSoles(validacion.total)} strong />
            {!validacion.valido && validacion.errores?.length > 0 && (
              <div className={styles.errores}>
                {validacion.errores.map((e, i) => <p key={i}>⚠️ {e}</p>)}
              </div>
            )}
            <Button
              variant="gold"
              size="lg"
              disabled={!validacion.valido}
              onClick={() => navigate('/checkout')}
              className={styles.checkoutBtn}
            >
              Ir a pagar
            </Button>
            {!validacion.valido && validacion.total < 10 && (
              <p className={styles.minNote}>Monto mínimo de compra: S/ 10.00</p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div className={strong ? styles.rowStrong : styles.row}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
