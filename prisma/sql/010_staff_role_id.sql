begin;

CREATE TABLE IF NOT EXISTS public.staff_roles (
  id integer PRIMARY KEY,
  nombre varchar(50) NOT NULL UNIQUE
);

INSERT INTO public.staff_roles (id, nombre)
VALUES
  (1, 'Admin'),
  (2, 'Monitor'),
  (3, 'Colaborador')
ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre;

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS role_id integer;

UPDATE public.staff
SET role_id = 3
WHERE role_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'staff_role_id_fkey'
      AND conrelid = 'public.staff'::regclass
  ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_role_id_fkey
      FOREIGN KEY (role_id)
      REFERENCES public.staff_roles(id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE public.staff
  ALTER COLUMN role_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_role_id ON public.staff(role_id);

commit;