import styles from './Input.module.css'

export default function Input({ label, error, className = '', ...rest }) {
  return (
    <label className={styles.wrapper}>
      {label && <span className={styles.label}>{label}</span>}
      <input className={`${styles.input} ${error ? styles.errorBorder : ''} ${className}`} {...rest} />
      {error && <span className={styles.error}>{error}</span>}
    </label>
  )
}
