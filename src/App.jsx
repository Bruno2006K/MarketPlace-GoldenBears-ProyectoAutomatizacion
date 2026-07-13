import { Routes, Route } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout.jsx'
import CatalogPage from './features/catalog/CatalogPage.jsx'
import CartPage from './features/cart/CartPage.jsx'
import CheckoutPage from './features/checkout/CheckoutPage.jsx'
import SellerDashboardPage from './features/seller/SellerDashboardPage.jsx'
import SellerOrdersPage from './features/seller/SellerOrdersPage.jsx'
import SellerInventoryPage from './features/seller/SellerInventoryPage.jsx'
import SwarmMonitorPage from './features/monitor/SwarmMonitorPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/carrito" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/vendedor" element={<SellerDashboardPage />} />
        <Route path="/vendedor/pedidos" element={<SellerOrdersPage />} />
        <Route path="/vendedor/inventario" element={<SellerInventoryPage />} />
        <Route path="/monitor" element={<SwarmMonitorPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
