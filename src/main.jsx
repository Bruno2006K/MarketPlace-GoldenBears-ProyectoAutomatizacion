import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import './index.css'
import App from './App.jsx'
import { CatalogProvider } from './context/CatalogContext.jsx'
import { AgentProvider } from './context/AgentContext.jsx'
import { CartProvider } from './context/CartContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <CatalogProvider>
        <AgentProvider>
          <CartProvider>
            <App />
            <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
          </CartProvider>
        </AgentProvider>
      </CatalogProvider>
    </BrowserRouter>
  </StrictMode>,
)
