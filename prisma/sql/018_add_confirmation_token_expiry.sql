-- Add confirmation token expiry support for reservas_solicitudes

ALTER TABLE IF EXISTS public.reservas_solicitudes
ADD COLUMN IF NOT EXISTS confirmation_token_expires_at timestamptz;

-- Create an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_reservas_solicitudes_token_expiry 
ON public.reservas_solicitudes(confirmation_token_expires_at);
