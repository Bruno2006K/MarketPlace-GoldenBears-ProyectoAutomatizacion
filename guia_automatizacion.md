# Guía de Automatización y Sistema Multiagente - Pardos Chicken 🍗🤖

Esta guía documenta toda la arquitectura, las herramientas de automatización y los servicios de Inteligencia Artificial que se han implementado en tu proyecto. Está diseñada para que sepas exactamente qué tecnologías sostienen el sistema y cómo configurarlas desde cero.

---

## 🛠️ Stack Tecnológico y Herramientas

### 1. **Supabase (Base de Datos en la Nube)**
* **Propósito:** Actúa como el cerebro de almacenamiento relacional de clase mundial. Guarda clientes, reservas, tickets, pagos y quejas.
* **Por qué se usó:** Para reemplazar el almacenamiento temporal del navegador (`localStorage`) por una base de datos real con relaciones (Llaves Foráneas), previniendo pérdida de datos y permitiendo que varios dispositivos (cajeros, mozos) sincronicen datos en vivo.
* **Componentes clave:**
  - Esquema Relacional: Tablas con IDs usando UUIDs.
  - JSONB: Para guardar datos complejos de IA (como los análisis de sentimientos en las quejas).

### 2. **Vite + React (Frontend)**
* **Propósito:** Construye la interfaz gráfica que ven los empleados (Dashboard, Reservas, Quejas IA, Asistente IA).
* **Por qué se usó:** React permite crear interfaces dinámicas y rápidas. Vite es el empaquetador moderno que hace que la aplicación cargue al instante durante el desarrollo y se compile optimizada para producción.

### 3. **Sistema Multiagente (LangChain / LangGraph)**
* **Propósito:** La red de inteligencia artificial que automatiza tareas complejas. En vez de un solo bot, tienes una corporación de "agentes" especializados:
  - `OrchestratorAgent`: El jefe que decide qué agente debe responder tu pregunta.
  - `CashAgent`: Analiza ventas y genera gráficos.
  - `ReservationAgent`: Sabe cuántas mesas hay y los estados de reserva.
  - `ClientAgent`: Sabe quiénes son los VIPs.
  - `ComplaintAgent` & `ResolutionAgent`: Analizan reclamos, entienden el sentimiento y ofrecen planes de compensación.

### 4. **Groq / Llama 3 (Motor de IA)**
* **Propósito:** El "cerebro pensante" detrás de los agentes.
* **Por qué se usó:** La API de Groq es una de las más rápidas del mundo para ejecutar modelos de código abierto (como Llama 3). Permite que el chat te responda en milisegundos en lugar de hacerte esperar.

### 5. **LangSmith (Observabilidad y Auditoría)**
* **Propósito:** Grabar y analizar cada cosa que los agentes de IA piensan y hacen.
* **Por qué se usó:** Cuando el Asistente IA falla o da una respuesta rara, LangSmith te permite entrar y ver exactamente qué le pidieron y por qué tomó esa decisión, manteniendo un historial auditable.

### 6. **Vercel (Hosting en Producción)**
* **Propósito:** El servidor en internet donde vive tu página web.
* **Por qué se usó:** Está diseñado específicamente para conectar con GitHub y aplicaciones React/Vite, permitiendo despliegues automáticos cada vez que guardas código.

---

## 🚀 Guía de Instalación y Uso desde Cero

Si alguna vez cambias de computadora o necesitas levantar el proyecto desde cero, sigue estos pasos:

### Paso 1: Requisitos Previos
1. Instalar **Node.js** (LTS) en tu computadora.
2. Instalar **Git**.
3. Tener una cuenta en GitHub, Supabase, Groq, LangSmith y Vercel.


### Paso 3: Configurar las Llaves (.env.local)
En la raíz de la carpeta `PARDOS`, crea un archivo llamado `.env.local`. Dentro debes pegar tus llaves secretas. **NUNCA subas este archivo a GitHub**.

```env
# Conexión a la Base de Datos
VITE_SUPABASE_URL=https://[TU_URL_DE_SUPABASE].supabase.co
VITE_SUPABASE_ANON_KEY=[TU_LLAVE_ANONIMA_DE_SUPABASE]

# Cerebro de Inteligencia Artificial (Groq/Gemini)
GROQ_API_KEY=[TU_LLAVE_DE_GROQ]
VITE_GEMINI_API_KEY=[TU_LLAVE_DE_GEMINI]

# Auditoría IA (LangSmith)
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=[TU_LLAVE_DE_LANGSMITH]
LANGSMITH_PROJECT=[NOMBRE_DE_TU_PROYECTO]
```

### Paso 4: Levantar la Base de Datos (Supabase)
Si tienes un Supabase nuevo, necesitas inicializar sus tablas:
1. Ve a la consola de Supabase > SQL Editor.
2. Pega el contenido del archivo `01_expert_schema.sql` (ubicado en tu proyecto) y ejecútalo.
3. Para insertar datos de prueba reales, abre tu terminal y ejecuta:
   ```bash
   node seedData.js
   ```

### Paso 5: Correr la Aplicación Localmente
```bash
npm run dev
```
Entra a `http://localhost:5173`. Aquí podrás probar modificaciones sin afectar a los usuarios reales.

---

## 🌐 Guía de Despliegue (Producción en Vercel)

Una vez que el proyecto funciona localmente, para actualizar tu página en internet (`https://proyecto-de-sistema-multiagente-par.vercel.app/`):

1. **Sube tus cambios a GitHub:**
   ```bash
   git add .
   git commit -m "Descripción de mi cambio"
   git push
   ```
2. Vercel detectará el cambio automáticamente y compilará la aplicación.
3. **¡IMPORTANTE!** Vercel no lee tu archivo `.env.local`. Debes ir al panel de Vercel:
   `Settings > Environment Variables`
   y copiar manualmente cada llave (Supabase, Groq, LangSmith) allí para que la versión pública funcione.

> [!TIP]
> **El error `Failed to fetch dynamically imported module`:**
> Si un usuario tiene la aplicación abierta justo en el momento en el que tú haces un `git push`, Vercel actualizará la página de golpe. Si el usuario intenta hacer clic, verá este error rojo. La solución es simple: pedirle que presione `F5` (Refrescar la página) para descargar la actualización.
