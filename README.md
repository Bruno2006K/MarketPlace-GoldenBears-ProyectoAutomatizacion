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
| Motor de agentes | `core/antigravity.py` (`AntigravityAgent`, `AgentGraph`, `SwarmOrchestrator`) | `src/agents/core/AgentBase.js` + `AgentOrchestrator.js` + **LangGraph.js real** (`src/agents/core/graphs/`) |
| Bus de eventos + JSON Schema | `core/schemas.py` + `core/event_bus.py` | `src/agents/core/EventBus.js` |
| Estado compartido + conflictos | `core/shared_state.py` (`AGENT_PRIORITY`) | `src/agents/core/SharedMemory.js` (`AGENT_PRIORITY`, `AGENT_PERMISSIONS`) |
| Agente Búsqueda + IA | `agents/busqueda_ia.py` | `src/agents/SearchAgent.js` |
| Agente Carrito y Pago | `agents/carrito_pago.py` | `src/agents/CartPaymentAgent.js` + `src/domain/pricing.js` |
| Agente Pedidos | `agents/pedidos.py` | `src/agents/OrderAgent.js` |
| Agente Inventario | `agents/inventario.py` | `src/agents/InventoryAgent.js` |
| Agente Notificaciones | `agents/notificaciones.py` (smtplib) | `src/agents/NotificationAgent.js` + `api/notify.js` (nodemailer) |
| Agente Orquestador | `agents/orchestrator.py` | Absorbido en `AgentOrchestrator.js` (topología híbrida estrella+cadena) |
| Catálogo mock | `data/mock_data.py` | `src/data/seeds/productsSeed.js` / `usersSeed.js` |
| API REST + WebSocket | `api/main.py` (FastAPI) | Reemplazado por llamadas directas a los agentes desde React (sin backend propio) + `api/llm.js`, `api/notify.js`, `api/trace.js` y `api/embed.js` como endpoints serverless (proxy de IA, email, observabilidad LangSmith y embeddings) |
| Persistencia | En memoria (`orders_store`, `dict` de stock) | Supabase (`01_golden_bears_schema.sql`, con pgvector) con fallback automático a datos locales |

Implementado 1:1 según `guia_automatizacion.md`:
- **LangGraph.js real** (`@langchain/langgraph`) orquesta el checkout (`checkoutGraph.js`: pago → pedido → swarm paralelo real vía fan-out) y la resolución de reclamos (`resolutionGraph.js`: `interrupt()`/`Command({resume})` para HITL real, con checkpointer `MemorySaver` por `correlationId`).
- **RAG / pgvector**: `SearchAgent.js` traduce la consulta a embedding (`api/embed.js` → Gemini `gemini-embedding-001`) y busca por similitud de coseno vía la función SQL `match_productos`; si Supabase/embeddings no están disponibles, cae automáticamente a búsqueda por texto.
- **LangSmith**: `api/trace.js` registra cada llamada real a Groq/Gemini y las alertas HITL del `ResolutionAgent`.
- **JWT**: `api/_guard.js` verifica (HS256, sin dependencias externas) el anon key de Supabase como Bearer token cuando `SUPABASE_JWT_SECRET` está configurado.
- **Prompt summarization**: `AgentBase.js` compacta el historial de cada agente cada 5 mensajes a un resumen + los últimos 3.
- Notificaciones: se mantiene **Nodemailer + Gmail SMTP** (`api/notify.js`) en vez de Resend/Twilio — funciona bien y es consistente con el backend Python original (`smtplib`).

---

## Arquitectura

```
CLIENTE (React) → AgentOrchestrator → LangGraph.js (checkoutGraph / resolutionGraph)
                          │                    │
                          ▼                    ▼
                   EVENT BUS (MCP, JSON Schema) → AGENTES → Supabase(+pgvector) / Gmail / Groq / Gemini / LangSmith
                          ↑                    PUBLISH                  ↓
                          └──────────────────── REPLY ←──────────────────┘

     SharedMemory (versionado + resolución de conflictos por prioridad)
```

**Topología:** Híbrida (Estrella + Cadena) — igual que el backend Python original, ahora ejecutada sobre StateGraphs reales de LangGraph.js.

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
# Edita .env con tus credenciales de Supabase (opcional) y Groq/Gemini (opcional)

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
| **producción** | `VITE_USE_PROXY=true` + `GROQ_API_KEY` / `GEMINI_API_KEY` en el servidor | Los agentes llaman a Groq Llama 3.1 8B o Gemini 1.5 Flash vía `/api/llm` |

Sin Supabase configurado, el catálogo se sirve desde `productsSeed.js` — el
sistema es 100% funcional sin infraestructura externa, igual que el backend
Python original con `mock_data.py`.

### Observabilidad con LangSmith (opcional)

Con `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` en el servidor, `/api/trace`
registra en LangSmith cada llamada real a Groq/Gemini (`llmClient.complete`) y
las alertas Human-in-the-loop del `ResolutionAgent` cuando la confianza de una
resolución autónoma es menor a 0.8. Sin esas variables, `/api/trace` responde
`{ disabled: true }` sin error: la observabilidad nunca bloquea el flujo
transaccional de los agentes.

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
rewrites que Pardos Chicken. `api/llm.js`, `api/notify.js`, `api/trace.js` y
`api/embed.js` se despliegan automáticamente como funciones serverless.
Recuerda configurar en Vercel: `GROQ_API_KEY`, `GEMINI_API_KEY`, `GMAIL_USER`,
`GMAIL_APP_PASSWORD`, `SELLER_EMAIL`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` y, opcionalmente, `SUPABASE_JWT_SECRET`,
`LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`.
