import { Link } from 'react-router-dom'
import { Package, TrendingUp, Clock, Truck } from 'lucide-react'
import { useAgents } from '../../context/AgentContext.jsx'
import { formatSoles } from '../../domain/pricing.js'
import Card from '../../components/ui/Card.jsx'
import styles from './SellerPages.module.css'

export default function SellerDashboardPage() {
  const { ordersStore } = useAgents()

  const totalRevenue = ordersStore.reduce((s, o) => s + o.total, 0)
  const pendientes = ordersStore.filter((o) => o.estado === 'pendiente').length
  const despachados = ordersStore.filter((o) => o.estado === 'despachado').length
  const tasaDespacho = ordersStore.length ? ((despachados / ordersStore.length) * 100).toFixed(1) : '0.0'

  return (
    <div className="container">
      <h1 className={styles.title}>Panel Vendedor</h1>

      <div className={styles.metricsGrid}>
        <MetricCard icon={<TrendingUp size={18} />} label="Revenue total" value={formatSoles(totalRevenue)} />
        <MetricCard icon={<Package size={18} />} label="Pedidos totales" value={ordersStore.length} />
        <MetricCard icon={<Clock size={18} />} label="Pendientes de despacho" value={pendientes} />
        <MetricCard icon={<Truck size={18} />} label="Tasa de despacho" value={`${tasaDespacho}%`} />
      </div>

      <div className={styles.linksRow}>
        <Link to="/vendedor/pedidos" className={styles.linkCard}>
          <Package size={20} />
          <div><strong>Pedidos</strong><p>Gestiona y despacha las órdenes confirmadas</p></div>
        </Link>
        <Link to="/vendedor/inventario" className={styles.linkCard}>
          <TrendingUp size={20} />
          <div><strong>Inventario</strong><p>Revisa el stock en tiempo real y las alertas</p></div>
        </Link>
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value }) {
  return (
    <Card className={styles.metricCard}>
      <div className={styles.metricIcon}>{icon}</div>
      <div>
        <div className={styles.metricLabel}>{label}</div>
        <div className={styles.metricValue}>{value}</div>
      </div>
    </Card>
  )
}
