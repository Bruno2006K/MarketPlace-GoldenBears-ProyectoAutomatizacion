# Guía de Automatización y Sistema Multiagente - MarketPlace Golden Bears 🐻🤖

Esta guía documenta la arquitectura, las herramientas de automatización y los servicios de Inteligencia Artificial diseñados para la integración en la plataforma **MarketPlace Golden Bears**. Este documento sirve como manual de referencia técnica para el desarrollo y despliegue del sistema multiagente utilizando **LangGraph**, **LangChain**, **LangSmith** y **Pydantic**.

---

## 📈 1. Contexto de Negocio y Problemática

### 1.1 El Caso de Negocio: MarketPlace Golden Bears
**MarketPlace Golden Bears** es una plataforma de comercio electrónico tipo *marketplace* con fulfillment centralizado que permite a los usuarios explorar y comprar productos de diversas marcas dentro de un único entorno digital nacional. 
* **Fase Actual:** Crecimiento inicial.
* **Métricas de Tráfico:** Registra entre **5,000 y 7,000 visitas mensuales**.
* **Picos de Demanda:** El 70% del tráfico diario se concentra entre las **16:00 y 20:00 horas**, alcanzando picos de entre **120 y 180 usuarios concurrentes**.

### 1.2 Problema Operativo
La plataforma presenta una fricción operativa significativa debido a la gestión manual de procesos críticos como pagos, pedidos y soporte. La clasificación y atención de reclamos es ineficiente, aumentando el riesgo de *churn* (pérdida de clientes). Adicionalmente, la falta de un sistema de atención automatizado y trazable compromete la escalabilidad durante los picos de demanda máxima (120-180 usuarios concurrentes).

### 1.3 Solución Propuesta e Integración Multiagente
Se plantea la implementación de un sistema multiagente (SMA) basado en **LangGraph** que implementa una topología de orquestación centralizada (Hub-and-Spoke), coordinada por un [AgentOrchestrator.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/core/AgentOrchestrator.js). La solución garantiza la integridad de datos mediante contratos **Pydantic**, comunicación asíncrona mediante un bus de eventos [EventBus.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/core/EventBus.js) compatible con el estándar **MCP (Model Context Protocol)** y seguridad perimetral a través de proxies serverless en Vercel [[api/_guard.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/api/_guard.js)].

---

## 🛠️ 2. Arquitectura de Orquestación: LangGraph y Flujos de IA

LangGraph es el núcleo del sistema de orquestación multiagente. A diferencia de las cadenas lineales tradicionales de LangChain, LangGraph modela el comportamiento del sistema como un **Grafo Dirigido**:

```
                       ┌──────────────┐
                       │  Input (User)│
                       └──────┬───────┘
                              │
                              ▼
                      ┌───────────────┐
                      │   Orquestador │◄──────┐
                      └──────┬────────┘       │
                             │                │
                ┌────────────┼────────────┐   │ (Conditional Edge / Loop)
                ▼            ▼            ▼   │
           [Concierge]  [Cart/Payment] [Resolution]
                │            │            │   │
                └────────────┼────────────┘   │
                             │                │
                             ▼                │
                     [Evaluación/HITL] ───────┘
```

### 2.1 Conceptos Fundamentales del Grafo
* **Nodos (Nodes):** Representan unidades de trabajo ejecutables (funciones de JavaScript o llamadas a LLMs). En LangGraph, un nodo puede ser:
  * **Nodo como LLM:** Un paso de generación de texto o JSON estructurado.
  * **Nodo como Agente:** Un agente completo con su propio ciclo de razonamiento (como un nodo especializado en búsquedas).
  * **Nodo como Función:** Lógica determinista libre de IA (consultar bases de datos SQL o realizar cálculos financieros).
* **Aristas (Edges):** Definen las rutas de transición entre nodos. Las **Aristas Condicionales (Conditional Edges)** evalúan decisiones lógicas basadas en el estado actual para enrutar el flujo al siguiente nodo.
* **Estado (State / Graph State):** Un contexto compartido persistente que viaja y evoluciona de nodo en nodo. Es definido típicamente mediante `TypedDict` o clases de **Pydantic** para garantizar trazabilidad y seguridad en las mutaciones de datos.

### 2.2 Conceptos Técnicos de Producción
* **Checkpointing (Memoria Persistente):** El grafo guarda una captura de su estado en cada paso. Si una transacción web falla o el contenedor serverless expira, el flujo multiagente puede reanudarse exactamente desde el último checkpoint estable sin perder el contexto conversacional o transaccional.
* **Human-in-the-loop (HITL):** Capacidad del grafo para pausarse de forma determinista ante procesos críticos (como reembolsos o aprobaciones manuales).
  * *Flujo:* `Nodo de Ejecución -> Interrupción -> Revisión Humana (Dashboard) -> Reanudación desde Checkpoint`.
* **Ciclos (Loops):** Permiten la autoevaluación iterativa. Si el resultado generado por un agente especialista no cumple con los criterios del validador (evaluación), el grafo lo redirige mediante una arista condicional hacia el paso anterior para su refinamiento.

### 2.3 Ciclo Lógico de un Agente (Plan-Execute-Evaluate-Decide)
1. **Planificación:** El agente analiza el requerimiento del usuario y descompone el problema en pasos lógicos de ejecución.
2. **Ejecución:** Invoca herramientas especializadas (*tools*) para interactuar con bases de datos u otros servicios.
3. **Evaluación:** Compara el resultado obtenido contra criterios de calidad o esquemas esperados (con soporte de agentes críticos o validación estricta).
4. **Decisión:** Si el resultado es válido, el ciclo finaliza; si se detectan anomalías, retorna mediante aristas condicionales a una fase anterior de corrección.

---

## 📐 3. Patrones de Diseño y Topología de Red de Agentes

### 3.1 Topología Centralizada (Hub-and-Spoke)
El sistema multiagente implementa un **Patrón Supervisor (Deep Agent)**. 
* El orquestador central [AgentOrchestrator.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/core/AgentOrchestrator.js) actúa como director exclusivo.
* Los agentes especialistas nunca se comunican de forma directa entre sí. Esto reduce el ruido conversacional, minimiza las alucinaciones del modelo y simplifica el mantenimiento del código.

### 3.2 Comunicación Basada en Eventos (EventBus MCP)
Los agentes se comunican de forma asíncrona publicando y suscribiéndose a un bus de eventos central [EventBus.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/core/EventBus.js). Cada mensaje sigue un formato estructurado de estilo **MCP (Model Context Protocol)**:
```json
{
  "type": "pedido.creado",
  "payload": {
    "ordenId": "ord_8828b8",
    "total": 129.90,
    "items": [...]
  },
  "source": "OrderAgent",
  "timestamp": "2026-07-13T16:54:19.000Z",
  "correlationId": "flow_checkout_1719283749"
}
```
* **Ventajas:** Desacopla por completo los componentes, facilita la auditoría de acciones, permite reintentos automáticos y simplifica la trazabilidad en tiempo real.

### 3.3 Memoria Compartida Controlada (SharedMemory)
Existe un almacén común para el estado transaccional temporal [SharedMemory.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/core/SharedMemory.js). Para evitar conflictos cuando múltiples agentes intentan escribir sobre el mismo estado, se implementa un control de versiones apoyado por **Prioridades de Agente (Conflict Resolution)**:
* `OrchestratorAgent`: Prioridad 10 (Máxima)
* `OrderAgent`: Prioridad 8
* `CartPaymentAgent`: Prioridad 7
* `InventoryAgent`: Prioridad 6
* `SearchAgent`: Prioridad 3
* `NotificationAgent`: Prioridad 2 (Mínima)

* **Aislamiento de Datos (AGENT_PERMISSIONS):** Cada agente cuenta con permisos de lectura y escritura restringidos exclusivamente a sus claves asignadas para prevenir la sobreescritura accidental y la fuga de información sensible.

---

## 📋 4. Catálogo Técnico de Agentes en el Sistema

A continuación, se detalla la implementación y comportamiento de los agentes definidos para la integración en la plataforma:

| Agente | Función Core | Stack y Herramientas | Comportamiento en Producción |
| :--- | :--- | :--- | :--- |
| **Orquestador**<br>*(OrchestratorAgent)* | Router de intención y Hub de eventos | [AgentOrchestrator.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/core/AgentOrchestrator.js)<br>`LangGraph.ConditionalEdge`<br>Pydantic `IntentSchema` | Clasifica la intención inicial de la entrada del usuario conversacional, invoca [api/_guard.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/api/_guard.js) para validaciones iniciales y enruta el flujo al agente correspondiente. |
| **Compras Inteligente**<br>*(ConciergeAgent)* | Búsqueda semántica, RAG y sugerencias | [SearchAgent.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/SearchAgent.js)<br>Supabase + **pgvector**<br>Tool: `search_products` | Traduce lenguaje natural a parámetros de búsqueda (ej. categoría, precio máximo), realiza búsquedas vectoriales, comprueba inventario y genera recomendaciones en base a marca. |
| **Carrito/Pago** | Lógica determinista transaccional y pagos | [CartPaymentAgent.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/CartPaymentAgent.js)<br>Pydantic `payment_payload`<br>Edge Functions en Supabase | Valida stock con consultas atómicas SQL, calcula totales, invoca de manera segura la pasarela y bloquea temporalmente el inventario. |
| **Pedidos**<br>*(PedidosAgent)* | Registro y persistencia transaccional | [OrderAgent.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/OrderAgent.js)<br>PostgreSQL (Supabase DB)<br>PostgreSQL Transactions | Escribe en base de datos. Ante fallos de creación en base de datos, inicia flujos de compensación para reversiones. |
| **Notificaciones**<br>*(NotificacionesAgent)* | Comunicación transaccional saliente | [NotificationAgent.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/NotificationAgent.js)<br>Resend / Twilio API<br>[api/notify.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/api/notify.js) | Consume eventos del bus e inyecta plantillas estáticas de frontend (evitando alucinación de contenido corporativo) para enviar WhatsApps/Emails. |
| **Resolución**<br>*(ResolutionAgent)* | Atención de quejas y reclamos complejos | `src/agents/ResolutionAgent.js` *(Propuesto)*<br>ReAct Pattern<br>Supabase Vector Store | Evalúa gravedad de quejas. Si el score de confianza en la resolución autónoma es **menor a 0.8**, pausa el flujo y activa alerta en LangSmith para revisión humana (HITL). |

---

## 🔬 5. Detalle de Funcionalidad e Integración por Agente

### 5.1 Orquestador ([AgentOrchestrator.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/core/AgentOrchestrator.js))
* **Qué hace:** Actúa como *gateway* de control e inferencia. No resuelve problemas, sino que mapea y gestiona las transiciones del estado del grafo.
* **Tecnología:** Configuración estática (`RouteTable`) + LLM (Gemini 1.5 Flash / Groq Llama 3.1 8B) para clasificar intenciones en JSON.
* **Input/Output:** Entrada en lenguaje natural -> `ActionObject` (JSON tipado que determina la transición al siguiente nodo en LangGraph).

### 5.2 Agente de Compras Inteligente ([SearchAgent.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/SearchAgent.js) / ConciergeAgent)
* **Flujo Interno de Búsqueda:**
  1. *Entendimiento Semántico:* Interpreta solicitudes del tipo: *"Regalo para acampar, presupuesto 50 USD"*.
  2. *Extracción de Entidades:* Usa modelos de validación Pydantic para expresar variables de búsqueda como `{ categoria: "camping", max_precio: 50.0 }`.
  3. *Búsqueda Vectorial (RAG):* Envía embeddings de búsqueda a Supabase usando **pgvector** para encontrar productos relacionados semánticamente.
  4. *Re-Ranking y Stock:* Llama a `check_stock()` para depurar productos no disponibles y ordenar los resultados más relevantes.
  5. *Generación de Respuesta:* Redacta una recomendación fluida, amigable y alineada con la voz de marca.

### 5.3 Carrito y Pago ([CartPaymentAgent.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/CartPaymentAgent.js))
* **Qué hace:** Es el agente más controlado. Tiene restricciones absolutas contra la generación de texto creativo para evitar transacciones erróneas.
* **Tecnología:** Ejecución determinista sobre Supabase Edge Functions. El LLM actúa únicamente como receptor pasivo de respuestas con formato estructurado, p. ej. `{"status": "success", "total": 50.00}`.
* **Validación de Carga:** Utiliza esquemas estrictos de Pydantic para asegurar que la carga de pago (`payment_payload`) contenga datos obligatorios (Token, Monto, CVV) antes de ser transmitidos a la pasarela externa.

### 5.4 Pedidos ([OrderAgent.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/OrderAgent.js))
* **Propósito:** Actuar como escritor en la base de datos Supabase garantizando atomicidad transaccional.
* **Flujo:** Si la creación del pedido en base de datos devuelve un fallo, se despacha un evento compensatorio que solicita la devolución inmediata del cargo monetario en la pasarela de pago.
* **Ciclo de Vida:** Gestiona la máquina de estados del pedido: `Pendiente -> Pagado -> Enviado`.

### 5.5 Notificaciones ([NotificationAgent.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/NotificationAgent.js))
* **Mecánica:** Opera de manera similar a un *Service Worker*. No evalúa el contenido ni toma decisiones corporativas.
* **Integración:** Inyecta datos dinámicos a plantillas de mensajería preexistentes en [api/notify.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/api/notify.js). La salida final no pasa por reinterpretación de texto del LLM, eliminando completamente la posibilidad de alucinación en detalles de facturación.

### 5.6 Agente de Resolución (`ResolutionAgent.js` - Integración de Soporte)
* **Patrón de Uso:** Implementa **ReAct (Reasoning + Acting)** para analizar las quejas y contrastarlas con el historial de compras en la base de datos Supabase.
* **Lógica de Decisión e HITL:**
  * Ante una queja, el agente propone una compensación (Reembolso, Cupón de descuento).
  * Si el nivel de confianza de la clasificación de la queja es `< 0.8`, escribe `needs_human_review: True` en el estado del grafo de LangGraph.
  * El grafo interrumpe su ejecución de inmediato y publica una alerta en **LangSmith** y en el panel de soporte para la intervención humana.

---

## 🔒 6. Pilares de Seguridad, Calidad y Anti-alucinación

Para garantizar la estabilidad y confiabilidad requeridas por MarketPlace Golden Bears en periodos de alto tráfico, se implementan tres pilares esenciales:

```
                  Petición del Cliente (Prompt)
                              │
                              ▼
            ┌───────────────────────────────────┐
            │  api/_guard.js (Seguridad Inicial)│
            │  - Sanitización de Prompts        │
            │  - Validación de Token JWT        │
            │  - Rate Limiting (Serverless IP)  │
            └─────────────────┬─────────────────┘
                              │
                              ▼
            ┌───────────────────────────────────┐
            │  Validación y Tipado Pydantic     │
            │  - Parseo de salidas del LLM      │
            │  - Reintentos automáticos en Grafo│
            └─────────────────┬─────────────────┘
                              │
                              ▼
            ┌───────────────────────────────────┐
            │  Anti-alucinación Determinista    │
            │  - Cálculos matemáticos en JS/SQL │
            │  - Respuestas crudas y filtradas  │
            └───────────────────────────────────┘
```

1. **Anti-alucinación:** 
   * Los inventarios, precios y balances financieros **nunca** son calculados por el LLM.
   * El sistema extrae los datos mediante consultas SQL deterministas en Supabase y el LLM solo se encarga de interpretarlos o formatearlos para el usuario final.
2. **Perímetro de Seguridad ([api/_guard.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/api/_guard.js)):**
   * Proxy serverless en Vercel que evalúa las peticiones entrantes.
   * Ejecuta: Validación del JWT del cliente, sanitización de inyecciones de *prompts* destructivos y restricción de tasa de llamadas (*rate limiting*).
3. **Pydantic (Contratos de Datos):**
   * Estructura las fronteras de comunicación entre los agentes. 
   * Si un nodo de LangGraph genera una salida JSON no válida de acuerdo al esquema esperado, el sistema intercepta el error y autoejecuta un ciclo de reintento en el nodo con el mensaje de depuración estructurado.

---

## ⚡ 7. Estrategias de Optimización de Tokens (Cost-Efficiency)

Para asegurar la viabilidad económica en producción bajo picos de 120-180 usuarios concurrentes, el sistema implementa tres capas de control sobre el consumo de tokens:

1. **Prompt Summarization (Memoria Compacta):** Evita el crecimiento exponencial del contexto histórico. El [AgentOrchestrator.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/core/AgentOrchestrator.js) activa un nodo de compactación cada 5 mensajes. Este nodo reduce el historial de chat a un resumen consolidado, manteniendo únicamente el resumen y los últimos 3 mensajes completos para enviar a las llamadas de API del LLM.
2. **System Prompt "Lean" (Cortos y Técnicos):** Se suprimen las instrucciones verbales extensas. Los *system prompts* de producción utilizan técnicas *Few-Shot* técnicas, proveyendo al LLM ejemplos concisos de entrada/salida en formato JSON para eliminar la necesidad de razonamiento deductivo innecesario sobre la estructura.
3. **Herramientas de Salida Estructurada:** Las funciones asociadas a la búsqueda no devuelven campos descriptivos largos al agente. Retornan un formato plano y depurado conteniendo solo `{ id, nombre, precio, stock }` (JSON limpio).

### Matriz de Uso de Tokens por Agente
* **ConciergeAgent:** **Alta** (Usa RAG filtrando y trayendo únicamente el top 3 de productos).
* **Carrito/Pago:** **Mínima / Nula** (Lógica determinista directa de base de datos SQL. Cero llamadas a APIs de LLM).
* **ResolutionAgent:** **Media** (Realiza clasificaciones basadas en etiquetas lógicas en lugar de análisis conversacional de texto plano).
* **Orquestador:** **Mínima** (Mapea intenciones básicas con baja cantidad de tokens de contexto).

---

## 🗺️ 8. Diagrama General del Flujo de Integración

A continuación se muestra el ciclo de ejecución asíncrono implementado en el sistema multiagente desde el ingreso del cliente hasta el registro de observabilidad:

```
[Cliente (Frontend/Vite)]
       │
       │ (1) Envia prompt e inputs
       ▼
[Vercel Serverless (api/_guard.js)]
       │
       │ (2) Valida JWT, rate limits y sanitiza entrada
       ▼
[OrchestratorAgent (LangGraph Node 0)] ────► [LangSmith] (7) Registra traza conversacional
       │
       │ (3) Identifica intención mediante Pydantic IntentSchema
       ├─────────────────────────────────────────┐
       │ (4a) Intención: Búsqueda                │ (4b) Intención: Reclamo/Queja
       ▼                                         ▼
[ConciergeAgent (SearchAgent)]            [ResolutionAgent]
       │ (RAG / pgvector)                        │ (Patrón ReAct / Vector Store)
       │                                         │ Si confianza < 0.8
       │                                         ▼
       │                                  [Human-In-The-Loop] ────► [Alerta LangSmith]
       ▼                                         │ (Pausa y aprobación manual)
[EventBus (MCP Events)] ◄────────────────────────┘
       │
       ├─────────────────────────────────────────┐
       │ (5a) Evento: pago.confirmado            │ (5b) Evento: notificacion.enviar
       ▼                                         ▼
[PedidosAgent (OrderAgent)]               [NotificacionesAgent (api/notify.js)]
       │                                         │
       │ (6a) Escritura atómica (SQL)            │ (6b) Envía e-mail/WhatsApp
       ▼                                         ▼
[Supabase Database]                      [Cliente / Destinatario Final]
```

---

## 🚀 9. Guía de Instalación, Configuración y Despliegue

### 9.1 Requisitos de Infraestructura
1. **Node.js** 20 (LTS) o superior.
2. Cuenta en **Supabase** (para la base de datos relacional y pgvector).
3. Cuenta en **Vercel** (para funciones serverless backend).
4. Cuenta y API Keys para **Gemini** (Google AI Studio) o **Groq** (Llama 3).
5. Cuenta de **LangSmith** para auditoría y observabilidad.

### 9.2 Variables de Env del Proyecto (.env.local)
Crea un archivo `.env` en la raíz del proyecto para desarrollo local:
```env
# URL y Llaves de conexión de Supabase
VITE_SUPABASE_URL=https://[TU_PROYECTO_ID].supabase.co
VITE_SUPABASE_ANON_KEY=[TU_LLAVE_ANONIMA]

# API Keys de LLMs
VITE_GEMINI_API_KEY=[TU_LLAVE_DE_GEMINI_PRODUCCION]
GROQ_API_KEY=[TU_LLAVE_DE_GROQ]

# Observabilidad con LangSmith
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=[TU_LLAVE_DE_LANGSMITH]
LANGSMITH_PROJECT=marketplace-goldenbears-sma

# Configuración de notificaciones
GMAIL_USER=notificaciones@goldenbears.com
GMAIL_APP_PASSWORD=[TU_PASSWORD_DE_APLICACION_GMAIL]
SELLER_EMAIL=ventas@goldenbears.com
```

### 9.3 Inicialización y Carga de Datos de Prueba (Seed)
1. Conéctate a tu proyecto en Supabase e ingresa al **SQL Editor**.
2. Copia y ejecuta la estructura SQL definida en el archivo [01_golden_bears_schema.sql](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/01_golden_bears_schema.sql). Esto creará las tablas necesarias (`productos`, `ordenes`, `tickets`, `pagos`, etc.) con identificadores UUID y soporte para embeddings vectoriales.
3. Para poblar el catálogo de productos inicial y los usuarios semilla en el entorno Supabase, ejecuta en tu terminal:
   ```bash
   npm run seed
   ```

### 9.4 Ejecución Local del Servidor de Desarrollo
Para levantar el frontend de desarrollo e interactuar con el entorno multiagente simulado o real:
```bash
# 1. Instalar las dependencias del proyecto
npm install

# 2. Correr la aplicación localmente
npm run dev
```
La aplicación estará disponible en `http://localhost:5173`. Las llamadas al sistema de agentes se pueden depurar visualmente desde el panel **Monitor SMA** en la interfaz.

### 9.5 Pruebas Unitarias y de Integración de Flujos
El proyecto contiene pruebas diseñadas para verificar la consistencia del enrutamiento y la interacción del bus de eventos:
```bash
npm run test:agents
```
Esta suite de pruebas valida la consistencia de los datos en [SharedMemory.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/src/agents/core/SharedMemory.js), el cálculo de IGV, la reserva y descuento de stocks, y la sincronización en paralelo mediante el id de correlación en el swarm del checkout.

### 9.6 Despliegue en Vercel
1. Conecta tu repositorio Git a la consola de Vercel.
2. Vercel detectará el archivo de configuración `vercel.json` y desplegará automáticamente la aplicación.
3. **Paso Mandatorio:** En la configuración del proyecto en Vercel (`Project Settings > Environment Variables`), registra todas las variables definidas en el archivo `.env.local`. De lo contrario, los agentes y las API serverless ([api/llm.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/api/llm.js), [api/notify.js](file:///e:/1.%20Tareas/Tareas%20UPAO/Ciclo%2007/Aut.Proc.Nego.Inter/AG/MarketPlace-GoldenBears-ProyectoAutomatizacion/api/notify.js)) fallarán al no poder autenticarse contra los proveedores de IA y base de datos.
