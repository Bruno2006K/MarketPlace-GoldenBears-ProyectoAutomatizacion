# 🐻 Marketplace Golden Bears — Sistema Multiagente (v2, React + Vite + Supabase)

**Automatización Inteligente de Procesos · 2026-10 · UPAO**
Integrantes: Escalante Días Rodrigo · Olguín Vásquez Danna · Ordóñez Gonzales Bruno · Rubiños Angulo Víctor

Este proyecto es una **migración completa** del backend original en Python/FastAPI
hacia la arquitectura frontend (React + Vite + agentes en JS + Supabase) usada en
el proyecto **Pardos Chicken**. Todo el sistema multiagente corre ahora en el
navegador, sin necesidad de un servidor Python.

---

## Qué se migró y de dónde

| Pieza | Origen (Python) | Destino (JS) |
|---|---|---|
| Motor de agentes | `core/antigravity.py` (`AntigravityAgent`, `AgentGraph`, `SwarmOrchestrator`) | `src/agents/core/AgentBase.js` + `AgentOrchestrator.js` |
| Bus de eventos + JSON Schema | `core/schemas.py` + `core/event_bus.py` | `src/agents/core/EventBus.js` |
| Estado compartido + conflictos | `core/shared_state.py` (`AGENT_PRIORITY`) | `src/agents/core/SharedMemory.js` (`AGENT_PRIORITY`, `AGENT_PERMISSIONS`) |
| Agente Búsqueda + IA | `agents/busqueda_ia.py` | `src/agents/SearchAgent.js` |
| Agente Carrito y Pago | `agents/carrito_pago.py` | `src/agents/CartPaymentAgent.js` + `src/domain/pricing.js` |
| Agente Pedidos | `agents/pedidos.py` | `src/agents/OrderAgent.js` |
| Agente Inventario | `agents/inventario.py` | `src/agents/InventoryAgent.js` |
| Agente Notificaciones | `agents/notificaciones.py` (smtplib) | `src/agents/NotificationAgent.js` + `api/notify.js` (nodemailer) |
| Agente Orquestador | `agents/orchestrator.py` | Absorbido en `AgentOrchestrator.js` (topología híbrida estrella+cadena) |
| Catálogo mock | `data/mock_data.py` | `src/data/seeds/productsSeed.js` / `usersSeed.js` |
| API REST + WebSocket | `api/main.py` (FastAPI) | Reemplazado por llamadas directas a los agentes desde React (sin backend propio) + `api/llm.js` y `api/notify.js` como únicos endpoints serverless (proxy de IA y email) |
| Persistencia | En memoria (`orders_store`, `dict` de stock) | Supabase (`01_golden_bears_schema.sql`) con fallback automático a datos locales |

**Lo que NO se migró tal cual** (simplificado a propósito, ver comentarios en el código):
- El soporte multi-proveedor de LLM de Pardos (Gemini/Groq/LangChain/LangSmith) se
  redujo a un solo proveedor (**Anthropic Claude Haiku**, igual que el Python
  original) detrás de un proxy serverless — misma filosofía de seguridad, menos
  complejidad innecesaria para este dominio.

---

## Arquitectura

```
CLIENTE (React) → AgentOrchestrator → EVENT BUS (MCP, JSON Schema) → AGENTES → Supabase / Gmail / Claude
                          ↑                    PUBLISH                  ↓
                          └──────────────────── REPLY ←──────────────────┘

     SharedMemory (versionado + resolución de conflictos por prioridad)
```

**Topología:** Híbrida (Estrella + Cadena) — igual que el backend Python original.

### Flujo de compra (con tramo paralelo / SWARM)

```
1. iniciarBusqueda        → SearchAgent
2. actualizarCarrito      → CartPaymentAgent.validar_carrito
3. procesarCheckout:
   a) CartPaymentAgent.procesar_pago     (secuencial)
   b) OrderAgent.crear_orden             (secuencial, depende de a)
   c) ⚡ SWARM en paralelo (Promise.all): InventoryAgent + NotificationAgent
```

Todo el flujo comparte un `correlationId`, visible en el panel **Monitor SMA**
(`/monitor`) para verificar la trazabilidad del swarm.

---

## Instalación y ejecución

### Requisitos
- Node.js 20+
- Cuenta gratuita de [Supabase](https://supabase.com) (opcional — sin ella, usa datos locales)

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env con tus credenciales de Supabase (opcional) y Anthropic (opcional)

# 3. (Opcional) Crear el schema en Supabase
#    Copia y ejecuta 01_golden_bears_schema.sql en el SQL Editor de tu proyecto Supabase

# 4. (Opcional) Poblar Supabase con el catálogo
npm run seed

# 5. Ejecutar en desarrollo
npm run dev
```

Abre `http://localhost:5173`.

### Modo demo vs producción

| Modo | Configuración | Comportamiento |
|---|---|---|
| **demo** (default) | `VITE_USE_PROXY=false` | Agentes usan heurística mock (razonamiento simulado, sin costo) |
| **producción** | `VITE_USE_PROXY=true` + `ANTHROPIC_API_KEY` en el servidor | Los agentes llaman a Claude Haiku vía `/api/llm` |

Sin Supabase configurado, el catálogo se sirve desde `productsSeed.js` — el
sistema es 100% funcional sin infraestructura externa, igual que el backend
Python original con `mock_data.py`.

---

## Ejecutar tests

```bash
npm run test:agents
```

Cubre: validación de JSON Schema del Event Bus, resolución de conflictos por
prioridad en SharedMemory, cálculo de IGV y reglas del carrito, descuento de
stock y alertas de inventario, y un test end-to-end del checkout completo
verificando que el swarm (Inventario + Notificaciones) comparte `correlationId`.

---

## Estructura de páginas

- `/` — Catálogo (SearchAgent)
- `/carrito` — Carrito (CartPaymentAgent.validar_carrito)
- `/checkout` — Pago y confirmación (swarm completo)
- `/vendedor` — Dashboard del vendedor
- `/vendedor/pedidos` — Gestión y despacho de pedidos
- `/vendedor/inventario` — Stock en tiempo real y alertas
- `/monitor` — Panel de monitoreo del Sistema Multiagente (equivalente al panel de Pardos)

---

## Despliegue en Vercel

El proyecto incluye `vercel.json` con los mismos headers de seguridad y
rewrites que Pardos Chicken. `api/llm.js` y `api/notify.js` se despliegan
automáticamente como funciones serverless. Recuerda configurar en Vercel:
`ANTHROPIC_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SELLER_EMAIL`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
