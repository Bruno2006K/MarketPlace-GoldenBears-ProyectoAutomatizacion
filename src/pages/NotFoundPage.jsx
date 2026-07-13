import { Link } from 'react-router-dom'
import styles from './NotFoundPage.module.css'

export default function NotFoundPage() {
  return (
    <div className={`container ${styles.wrapper}`}>
      <span className={styles.emoji}>🐻</span>
      <h1>404</h1>
      <p>Esta página no existe en el Marketplace Golden Bears.</p>
      <Link to="/" className={styles.link}>Volver a la tienda</Link>
    </div>
  )
}
