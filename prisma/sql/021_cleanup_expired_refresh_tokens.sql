-- Safe maintenance: expired sessions can no longer authenticate and revoked
-- sessions older than 30 days are no longer useful.
DELETE FROM public.staff_refresh_tokens
WHERE expires_at < now()
   OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days');

ANALYZE public.staff_refresh_tokens;

