-- ════════════════════════════════════════════════════════════════════════
-- 01_golden_bears_schema.sql
-- Schema de Supabase (Postgres) para el Marketplace Golden Bears — SMA.
-- Adaptado del esquema de Pardos Chicken (01_expert_schema.sql) al dominio
-- de e-commerce: catálogo, carrito, pagos, pedidos, inventario, notificaciones.
-- ════════════════════════════════════════════════════════════════════════

-- ── Extensiones ─────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ── Catálogo de productos ───────────────────────────────────────────────
create table if not exists productos (
  id            text primary key,                 -- ej. PROD-001
  nombre        text not null,
  categoria     text not null,
  marca         text not null,
  precio        numeric(10,2) not null check (precio >= 0),
  stock         integer not null default 0 check (stock >= 0),
  rating        numeric(2,1) default 4.5,
  descripcion   text,
  imagen        text,
  tags          text[] default '{}',
  embedding     vector(768),                        -- Gemini gemini-embedding-001 (RAG, ver SearchAgent.js)
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists idx_productos_categoria on productos (categoria);
create index if not exists idx_productos_marca on productos (marca);
create index if not exists idx_productos_embedding
  on productos using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- match_productos — búsqueda semántica (RAG) por similitud de coseno, con
-- filtros opcionales de categoría y precio máximo (ver guia_automatizacion.md,
-- sección 5.2: "Búsqueda Vectorial (RAG)" del ConciergeAgent/SearchAgent).
create or replace function match_productos(
  query_embedding vector(768),
  match_count int default 12,
  filtro_categoria text default null,
  precio_max numeric default null
)
returns table (
  id text, nombre text, categoria text, marca text, precio numeric,
  stock integer, rating numeric, descripcion text, imagen text, tags text[],
  similitud float
)
language sql stable
as $$
  select
    p.id, p.nombre, p.categoria, p.marca, p.precio, p.stock, p.rating,
    p.descripcion, p.imagen, p.tags,
    1 - (p.embedding <=> query_embedding) as similitud
  from productos p
  where p.embedding is not null
    and (filtro_categoria is null or p.categoria ilike filtro_categoria)
    and (precio_max is null or p.precio <= precio_max)
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- ── Usuarios (compradores demo) ─────────────────────────────────────────
create table if not exists usuarios (
  id        text primary key,                     -- ej. USR-001
  nombre    text not null,
  email     text unique,
  telefono  text,
  creado_en timestamptz not null default now()
);

-- ── Carritos (estado transitorio, uno activo por usuario) ───────────────
create table if not exists carritos (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    text references usuarios(id),
  items         jsonb not null default '[]',       -- [{producto_id, cantidad, precio_unitario, subtotal, nombre}]
  subtotal      numeric(10,2) default 0,
  igv           numeric(10,2) default 0,
  total         numeric(10,2) default 0,
  valido        boolean default false,
  actualizado_en timestamptz not null default now()
);

-- ── Órdenes / Pedidos ────────────────────────────────────────────────────
create table if not exists ordenes (
  id                       text primary key,        -- ej. ORD-XXXXXXXX
  usuario_id               text references usuarios(id),
  items                    jsonb not null default '[]',
  subtotal                 numeric(10,2) not null,
  igv                      numeric(10,2) not null,
  total                    numeric(10,2) not null,
  metodo_pago              text not null,
  transaccion_id           text,
  factura_id               text,
  estado                   text not null default 'pendiente'
                            check (estado in ('pendiente','confirmado','despachado','entregado','cancelado')),
  numero_guia              text,
  fecha_creacion            timestamptz not null default now(),
  fecha_entrega_estimada   date,
  fecha_despacho           timestamptz
);

create index if not exists idx_ordenes_usuario on ordenes (usuario_id);
create index if not exists idx_ordenes_estado on ordenes (estado);

-- ── Movimientos de inventario (auditoría de stock) ──────────────────────
create table if not exists movimientos_inventario (
  id              uuid primary key default gen_random_uuid(),
  producto_id     text references productos(id),
  orden_id        text references ordenes(id),
  cantidad_vendida integer not null,
  stock_anterior  integer not null,
  stock_nuevo     integer not null,
  nivel_alerta    text,                              -- STOCK_BAJO | AGOTADO | null
  creado_en       timestamptz not null default now()
);

-- ── Notificaciones enviadas ──────────────────────────────────────────────
create table if not exists notificaciones (
  id            uuid primary key default gen_random_uuid(),
  orden_id      text references ordenes(id),
  usuario_id    text references usuarios(id),
  canales       text[] default '{}',
  mensaje       text,
  exito         boolean default true,
  creado_en     timestamptz not null default now()
);

-- ── Log de eventos del Event Bus (trazabilidad MCP) ─────────────────────
create table if not exists eventos_log (
  evento_id       uuid primary key default gen_random_uuid(),
  tipo            text not null,
  origen          text not null,
  correlacion_id  text,
  payload         jsonb not null default '{}',
  creado_en       timestamptz not null default now()
);

create index if not exists idx_eventos_tipo on eventos_log (tipo);
create index if not exists idx_eventos_correlacion on eventos_log (correlacion_id);

-- ── Row Level Security (demo: lectura pública, escritura vía anon key) ──
alter table productos enable row level security;
alter table usuarios enable row level security;
alter table carritos enable row level security;
alter table ordenes enable row level security;
alter table movimientos_inventario enable row level security;
alter table notificaciones enable row level security;
alter table eventos_log enable row level security;

create policy "productos_publico_lectura" on productos for select using (true);
create policy "productos_publico_escritura" on productos for all using (true) with check (true);
create policy "usuarios_publico" on usuarios for all using (true) with check (true);
create policy "carritos_publico" on carritos for all using (true) with check (true);
create policy "ordenes_publico" on ordenes for all using (true) with check (true);
create policy "movimientos_publico" on movimientos_inventario for all using (true) with check (true);
create policy "notificaciones_publico" on notificaciones for all using (true) with check (true);
create policy "eventos_publico" on eventos_log for all using (true) with check (true);

-- Nota: RLS "abierta" es aceptable para el modo demo académico (misma
-- estrategia que Pardos Chicken con anon key). Para producción real se
-- recomienda restringir escritura a un rol autenticado.
