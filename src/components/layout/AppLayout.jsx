import { Link, NavLink, Outlet } from 'react-router-dom'
import { ShoppingCart, Store, Activity } from 'lucide-react'
import { useCart } from '../../context/CartContext.jsx'
import styles from './AppLayout.module.css'

export default function AppLayout() {
  const { totalUnidades } = useCart()

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={`container ${styles.headerInner}`}>
          <Link to="/" className={styles.brand}>
            <span className={styles.brandIcon}>🐻</span>
            <span>Golden Bears</span>
          </Link>

          <nav className={styles.nav}>
            <NavLink to="/" end className={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>Tienda</NavLink>
            <NavLink to="/vendedor" className={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
              <Store size={15} /> Vendedor
            </NavLink>
            <NavLink to="/monitor" className={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
              <Activity size={15} /> Monitor SMA
            </NavLink>
          </nav>

          <Link to="/carrito" className={styles.cartLink}>
            <ShoppingCart size={20} />
            {totalUnidades > 0 && <span className={styles.cartBadge}>{totalUnidades}</span>}
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <footer className={styles.footer}>
        <div className="container">
          Golden Bears Marketplace · Sistema Multiagente Event-Driven · UPAO 2026
        </div>
      </footer>
    </div>
  )
}
