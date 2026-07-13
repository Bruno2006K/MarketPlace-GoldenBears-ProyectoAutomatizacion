import styles from './Button.module.css'

export default function Button({ children, variant = 'primary', size = 'md', loading = false, disabled = false, type = 'button', onClick, className = '', ...rest }) {
  return (
    <button
      type={type}
      className={`${styles.btn} ${styles[variant] || ''} ${styles[size] || ''} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
      {...rest}
    >
      {loading ? <span className={styles.spinner} /> : children}
    </button>
  )
}
