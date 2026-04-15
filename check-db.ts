import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL o DIRECT_URL no está configurada");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function checkDatabase() {
  try {
    console.log("🔍 Verificando datos en la BD...\n");

    // Count eventos
    const eventosCount = await prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*) as count FROM public.eventos
    `;
    console.log(`📅 Eventos: ${eventosCount[0].count}`);

    // Count horarios_evento
    const horariosCount = await prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*) as count FROM public.horarios_evento
    `;
    console.log(`⏰ Horarios Evento: ${horariosCount[0].count}`);

    // Count salones
    const salonesCount = await prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*) as count FROM public.salones
    `;
    console.log(`🏛️  Salones: ${salonesCount[0].count}`);

    // Count staff
    const staffCount = await prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*) as count FROM public.staff
    `;
    console.log(`👥 Staff: ${staffCount[0].count}`);

    // Show first 3 staff records
    if (staffCount[0].count > 0) {
      const staffRecords = await prisma.$queryRaw<
        Array<{ id: string; email: string; nombre: string }>
      >`
        SELECT id, email, nombre FROM public.staff LIMIT 3
      `;
      console.log("\n📋 Primeros 3 staff:");
      staffRecords.forEach((s) => {
        console.log(`   - ${s.nombre} (${s.email})`);
      });
    }

    // Check if there are any eventos with horarios
    const eventosWithHorarios = await prisma.$queryRaw<
      [{ count: number }]
    >`
      SELECT COUNT(DISTINCT e.id) as count
      FROM public.eventos e
      INNER JOIN public.horarios_evento h ON h.evento_id = e.id
    `;
    console.log(
      `\n✅ Eventos con horarios asociados: ${eventosWithHorarios[0].count}`
    );

    if (eventosWithHorarios[0].count === 0 && eventosCount[0].count > 0) {
      console.log("⚠️  Hay eventos pero sin horarios asociados");
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("❌ Error:", error.message);
    } else {
      console.error("❌ Error desconocido:", error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();
