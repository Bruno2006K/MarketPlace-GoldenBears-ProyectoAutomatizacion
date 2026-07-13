import { useCatalog } from '../../context/CatalogContext.jsx'
import { useAgents } from '../../context/AgentContext.jsx'
import Card from '../../components/ui/Card.jsx'
import styles from './SellerPages.module.css'

export default function SellerInventoryPage() {
  const { productos } = useCatalog()
  const { orchestrator } = useAgents()

  const stockInfo = productos.map((p) => {
    const stock = orchestrator.getStock(p.id)
    const nivel = stock === 0 ? 'agotado' : stock < 5 ? 'bajo' : 'ok'
    return { ...p, stockActual: stock, nivel }
  })

  const alertas = stockInfo.filter((p) => p.nivel !== 'ok')

  return (
    <div className="container">
      <h1 className={styles.title}>Inventario</h1>

      {alertas.length > 0 && (
        <Card className={styles.alertBanner}>
          ⚠️ {alertas.length} producto(s) con stock bajo o agotado — InventoryAgent generó alertas automáticas.
        </Card>
      )}

      <div className={styles.inventoryTable}>
        <div className={styles.inventoryHeaderRow}>
          <span>Producto</span><span>Marca</span><span>Categoría</span><span>Precio</span><span>Stock</span><span>Estado</span>
        </div>
        {stockInfo.map((p) => (
          <div key={p.id} className={styles.inventoryRow}>
            <span className={styles.prodName}>{p.nombre}</span>
            <span>{p.marca}</span>
            <span className={styles.capitalize}>{p.categoria}</span>
            <span>S/ {p.precio.toFixed(2)}</span>
            <span>{p.stockActual}</span>
            <span>
              {p.nivel === 'ok' && <span className="badge badge-success">OK</span>}
              {p.nivel === 'bajo' && <span className="badge badge-warning">Stock bajo</span>}
              {p.nivel === 'agotado' && <span className="badge badge-danger">Agotado</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
