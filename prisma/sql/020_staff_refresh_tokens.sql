-- Persistent refresh-token sessions for staff login.
-- Apply this script in production to avoid relying on runtime table creation.

CREATE TABLE IF NOT EXISTS public.staff_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  replaced_by_token_hash text,
  created_from_ip text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_staff_refresh_tokens_staff_id
  ON public.staff_refresh_tokens (staff_id);

CREATE INDEX IF NOT EXISTS idx_staff_refresh_tokens_expires_at
  ON public.staff_refresh_tokens (expires_at);
