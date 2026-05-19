const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const reservationId = process.argv[2];
  if (!reservationId) {
    console.error('Usage: node extend-confirm-expiry.js <reservationId>');
    process.exit(2);
  }

  const result = await prisma.$executeRawUnsafe(`
    UPDATE public.reservas_solicitudes
    SET confirmation_token_expires_at = now() + interval '24 hours', updated_at = now()
    WHERE id::text = '${reservationId}'
  `);

  console.log('SQL result:', result);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
