const { Pool } = require('pg');

async function main() {
  const reservationId = process.argv[2];
  if (!reservationId) {
    console.error('Usage: node extend-confirm-expiry-pg.js <reservationId>');
    process.exit(2);
  }

  let connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Try fallback to backend/.env
    try {
      const fs = require('fs');
      const envText = fs.readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8');
      const m = envText.match(/^DATABASE_URL\s*=\s*"([^"]+)"/m) || envText.match(/^DATABASE_URL\s*=\s*([^\n\r]+)/m);
      if (m) connectionString = m[1].trim();
    } catch (err) {
      // ignore
    }
  }
  if (!connectionString) {
    console.error('DATABASE_URL env var is required (or set it in backend/.env)');
    process.exit(3);
  }

  const pool = new Pool({ connectionString });
  try {
    const res = await pool.query(
      `UPDATE public.reservas_solicitudes
       SET confirmation_token_expires_at = now() + interval '24 hours', updated_at = now()
       WHERE id::text = $1 RETURNING id::text, confirmation_token_expires_at, created_at`,
      [reservationId]
    );

    console.log('rows:', res.rows);
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
