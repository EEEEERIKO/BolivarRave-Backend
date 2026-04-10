begin;

CREATE TABLE IF NOT EXISTS public.staff_credentials (
  staff_id uuid PRIMARY KEY REFERENCES public.staff(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  password_algo varchar(32) NOT NULL DEFAULT 'scrypt',
  created_at timestamptz NOT NULL DEFAULT now(),
  password_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_credentials_updated_at
  ON public.staff_credentials(password_updated_at);

commit;
