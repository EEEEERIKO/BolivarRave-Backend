-- Inventory schema for groups and items.

CREATE TABLE IF NOT EXISTS public.inventory_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  icono text NOT NULL DEFAULT 'inventory_2',
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_groups_orden_idx ON public.inventory_groups (orden);

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.inventory_groups(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  codigo text NOT NULL,
  salon text NOT NULL,
  estado text NOT NULL DEFAULT 'Disponible',
  defectuoso boolean NOT NULL DEFAULT false,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_items_estado_chk CHECK (estado IN ('Disponible', 'Fijo')),
  CONSTRAINT inventory_items_group_code_unique UNIQUE (group_id, codigo)
);

CREATE INDEX IF NOT EXISTS inventory_items_group_id_idx ON public.inventory_items (group_id);
CREATE INDEX IF NOT EXISTS inventory_items_estado_idx ON public.inventory_items (estado);
CREATE INDEX IF NOT EXISTS inventory_items_defectuoso_idx ON public.inventory_items (defectuoso);

CREATE TABLE IF NOT EXISTS public.inventory_state (
  llave text PRIMARY KEY,
  valor text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);