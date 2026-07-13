import { useState } from 'react'
import toast from 'react-hot-toast'
import { Truck } from 'lucide-react'
import { useAgents } from '../../context/AgentContext.jsx'
import { formatSoles } from '../../domain/pricing.js'
import Card from '../../components/ui/Card.jsx'
import Button from '../../components/ui/Button.jsx'
import styles from './SellerPages.module.css'

export default function SellerOrdersPage() {
  const { ordersStore, despacharPedido } = useAgents()
  const [despachando, setDespachando] = useState(null)

  const handleDespachar = async (ordenId) => {
    setDespachando(ordenId)
    const res = despacharPedido(ordenId)
    if (res.exito) toast.success(`Pedido ${ordenId} despachado — Guía ${res.numeroGuia}`)
    else toast.error(res.error || 'No se pudo despachar')
    setDespachando(null)
  }

  return (
    <div className="container">
      <h1 className={styles.title}>Pedidos</h1>

      {!ordersStore.length && <Card><p>Aún no hay pedidos confirmados.</p></Card>}

      <div className={styles.ordersList}>
        {[...ordersStore].reverse().map((o) => (
          <Card key={o.ordenId} className={styles.orderCard}>
            <div className={styles.orderHeader}>
              <div>
                <strong>{o.ordenId}</strong>
                <span className={styles.orderMeta}> · {o.facturaId} · {new Date(o.fechaCreacion).toLocaleString('es-PE')}</span>
              </div>
              <span className={`badge ${o.estado === 'despachado' ? 'badge-success' : 'badge-warning'}`}>{o.estado}</span>
            </div>
            <div className={styles.orderItems}>
              {(o.items || []).map((i, idx) => (
                <span key={idx}>{i.nombre} x{i.cantidad}{idx < o.items.length - 1 ? ', ' : ''}</span>
              ))}
            </div>
            <div className={styles.orderFooter}>
              <strong>{formatSoles(o.total)}</strong>
              {o.estado === 'pendiente' ? (
                <Button size="sm" variant="gold" loading={despachando === o.ordenId} onClick={() => handleDespachar(o.ordenId)}>
                  <Truck size={14} /> Despachar
                </Button>
              ) : (
                <span className={styles.guia}>Guía: {o.numeroGuia}</span>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
