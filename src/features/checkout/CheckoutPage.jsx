import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CreditCard, CheckCircle2, XCircle, Package, Bell, Boxes } from 'lucide-react'
import { useCart } from '../../context/CartContext.jsx'
import { useCatalog } from '../../context/CatalogContext.jsx'
import { useAgents } from '../../context/AgentContext.jsx'
import { validarItemsCarrito, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, formatSoles } from '../../domain/pricing.js'
import Card from '../../components/ui/Card.jsx'
import Button from '../../components/ui/Button.jsx'
import styles from './CheckoutPage.module.css'

export default function CheckoutPage() {
  const { items, clearCart } = useCart()
  const { productos } = useCatalog()
  const { procesarCheckout } = useAgents()
  const navigate = useNavigate()

  const [metodoPago, setMetodoPago] = useState('tarjeta')
  const [procesando, setProcesando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const carrito = items.length && productos.length ? validarItemsCarrito(items, productos) : null

  if (!items.length && !resultado) {
    navigate('/carrito')
    return null
  }

  const handlePagar = async () => {
    setProcesando(true)
    const res = await procesarCheckout({
      usuarioId: 'USR-001',
      items: carrito.itemsValidados,
      total: carrito.total,
      metodoPago,
    })
    setResultado(res)
    setProcesando(false)
    if (res.exito) clearCart()
  }

  if (resultado) {
    return <ResultadoCheckout resultado={resultado} onVolver={() => navigate('/')} />
  }

  return (
    <div className={`container ${styles.wrapper}`}>
      <Card className={styles.formCard}>
        <h1>Método de pago</h1>
        <div className={styles.methods}>
          {PAYMENT_METHODS.map((m) => (
            <label key={m} className={metodoPago === m ? styles.methodActive : styles.method}>
              <input type="radio" name="metodo" checked={metodoPago === m} onChange={() => setMetodoPago(m)} />
              {PAYMENT_METHOD_LABELS[m]}
            </label>
          ))}
        </div>

        <div className={styles.flowPreview}>
          <p className={styles.flowTitle}>Al confirmar, el sistema multiagente ejecutará:</p>
          <ol>
            <li>CartPaymentAgent → procesa el pago vía Gateway</li>
            <li>OrderAgent → crea la orden y genera la factura</li>
            <li>⚡ SWARM en paralelo: InventoryAgent + NotificationAgent</li>
          </ol>
        </div>
      </Card>

      <Card className={styles.summary}>
        <h2>Resumen del pedido</h2>
        {carrito && (
          <>
            {carrito.itemsValidados.map((i) => (
              <div key={i.producto_id} className={styles.row}>
                <span>{i.nombre} x{i.cantidad}</span>
                <span>{formatSoles(i.subtotal)}</span>
              </div>
            ))}
            <div className={styles.row}><span>Subtotal</span><span>{formatSoles(carrito.subtotal)}</span></div>
            <div className={styles.row}><span>IGV (18%)</span><span>{formatSoles(carrito.igv)}</span></div>
            <div className={styles.rowStrong}><span>Total</span><span>{formatSoles(carrito.total)}</span></div>
            <Button variant="gold" size="lg" loading={procesando} onClick={handlePagar} className={styles.payBtn}>
              <CreditCard size={16} /> Confirmar y pagar
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}

function ResultadoCheckout({ resultado, onVolver }) {
  const ok = resultado.exito
  return (
    <div className="container">
      <Card className={styles.resultCard}>
        {ok ? <CheckCircle2 size={56} color="#059669" /> : <XCircle size={56} color="#dc2626" />}
        <h2>{ok ? '¡Pedido confirmado!' : 'No se pudo procesar el pago'}</h2>
        <p className={styles.resultMsg}>{resultado.mensaje}</p>

        {ok && (
          <div className={styles.swarmTrace}>
            <p className={styles.flowTitle}>Trazabilidad del swarm (correlationId: {resultado.correlationId})</p>
            <div className={styles.traceGrid}>
              <TraceItem icon={<Package size={16} />} label="Pedido" value={resultado.pedido?.ordenId} sub={`Factura ${resultado.pedido?.facturaId}`} />
              <TraceItem icon={<Boxes size={16} />} label="Inventario" value={`${resultado.inventario?.itemsActualizados?.length || 0} productos actualizados`} sub={resultado.inventario?.alertasStock?.length ? `${resultado.inventario.alertasStock.length} alerta(s) de stock` : 'Sin alertas'} />
              <TraceItem icon={<Bell size={16} />} label="Notificaciones" value={`${resultado.notificaciones?.canales?.length || 0} canales`} sub={resultado.notificaciones?.emailRealEnviado ? 'Email real enviado' : 'Email simulado (demo)'} />
            </div>
          </div>
        )}

        <Button variant="primary" onClick={onVolver} className={styles.volverBtn}>Volver a la tienda</Button>
      </Card>
    </div>
  )
}

function TraceItem({ icon, label, value, sub }) {
  return (
    <div className={styles.traceItem}>
      <div className={styles.traceIcon}>{icon}</div>
      <div>
        <div className={styles.traceLabel}>{label}</div>
        <div className={styles.traceValue}>{value}</div>
        <div className={styles.traceSub}>{sub}</div>
      </div>
    </div>
  )
}
