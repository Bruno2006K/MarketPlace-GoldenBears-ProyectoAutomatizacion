import { useEffect, useState, useCallback } from 'react'
import { Search, Star, ShoppingCart } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCatalog } from '../../context/CatalogContext.jsx'
import { useAgents } from '../../context/AgentContext.jsx'
import { useCart } from '../../context/CartContext.jsx'
import { formatSoles } from '../../domain/pricing.js'
import Card from '../../components/ui/Card.jsx'
import Button from '../../components/ui/Button.jsx'
import Input from '../../components/ui/Input.jsx'
import styles from './CatalogPage.module.css'

const CATEGORIAS = ['todas', 'calzado', 'ropa', 'accesorios', 'tecnologia', 'hogar']

export default function CatalogPage() {
  const { productos, loading } = useCatalog()
  const { buscarProductos } = useAgents()
  const { addItem } = useCart()

  const [query, setQuery] = useState('')
  const [categoria, setCategoria] = useState('todas')
  const [resultados, setResultados] = useState([])
  const [recomendaciones, setRecomendaciones] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [razonamiento, setRazonamiento] = useState('')

  const ejecutarBusqueda = useCallback(async (q, cat) => {
    if (!productos.length) return
    setBuscando(true)
    const filtros = cat && cat !== 'todas' ? { categoria: cat } : {}
    const res = await buscarProductos(q, filtros)
    if (res.success) {
      setResultados(res.result.productos)
      setRecomendaciones(res.result.recomendaciones)
      setRazonamiento(res.result.razonamientoIA)
    }
    setBuscando(false)
  }, [productos, buscarProductos])

  // ejecutarBusqueda es async y hace los setState tras el await al SearchAgent,
  // no sincrónicamente dentro del efecto — patrón estándar de fetch-on-mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { ejecutarBusqueda(query, categoria) }, [productos])

  const handleSubmit = (e) => {
    e.preventDefault()
    ejecutarBusqueda(query, categoria)
  }

  const handleCategoria = (cat) => {
    setCategoria(cat)
    ejecutarBusqueda(query, cat)
  }

  const handleAdd = (producto) => {
    addItem(producto.id, 1)
    toast.success(`${producto.nombre} agregado al carrito`)
  }

  if (loading) return <div className="container"><p>Cargando catálogo…</p></div>

  return (
    <div className="container">
      <section className={styles.hero}>
        <h1>Golden Bears Marketplace</h1>
        <p>Encuentra lo que buscas — nuestro Agente de Búsqueda e IA analiza el catálogo por ti.</p>
        <form onSubmit={handleSubmit} className={styles.searchBar}>
          <Search size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Buscar zapatillas, audífonos, ropa…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" variant="gold" loading={buscando}>Buscar</Button>
        </form>
        <div className={styles.categorias}>
          {CATEGORIAS.map((c) => (
            <button key={c} className={c === categoria ? styles.catActive : styles.catBtn} onClick={() => handleCategoria(c)}>
              {c}
            </button>
          ))}
        </div>
      </section>

      {razonamiento && <p className={styles.iaNote}>🤖 SearchAgent: {razonamiento}</p>}

      <div className="grid-products">
        {resultados.map((p) => (
          <ProductCard key={p.id} producto={p} onAdd={() => handleAdd(p)} />
        ))}
      </div>

      {!resultados.length && !buscando && (
        <p className={styles.empty}>No se encontraron productos para tu búsqueda.</p>
      )}

      {recomendaciones.length > 0 && (
        <section className={styles.recSection}>
          <h2>También te puede gustar</h2>
          <div className="grid-products">
            {recomendaciones.map(({ producto, razon }) => (
              <ProductCard key={producto.id} producto={producto} onAdd={() => handleAdd(producto)} razon={razon} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ProductCard({ producto, onAdd, razon }) {
  const agotado = producto.stock === 0
  return (
    <Card className={styles.productCard} padded={false}>
      <img src={producto.imagen} alt={producto.nombre} className={styles.productImg} loading="lazy" />
      <div className={styles.productBody}>
        <span className={styles.productBrand}>{producto.marca}</span>
        <h3 className={styles.productName}>{producto.nombre}</h3>
        <div className={styles.rating}><Star size={13} fill="#c9a84c" color="#c9a84c" /> {producto.rating}</div>
        {razon && <p className={styles.razon}>{razon}</p>}
        <div className={styles.priceRow}>
          <span className={styles.price}>{formatSoles(producto.precio)}</span>
          {agotado ? (
            <span className="badge badge-danger">Agotado</span>
          ) : producto.stock < 5 ? (
            <span className="badge badge-warning">¡Últimas {producto.stock}!</span>
          ) : null}
        </div>
        <Button variant="primary" size="sm" disabled={agotado} onClick={onAdd} className={styles.addBtn}>
          <ShoppingCart size={14} /> Agregar
        </Button>
      </div>
    </Card>
  )
}
