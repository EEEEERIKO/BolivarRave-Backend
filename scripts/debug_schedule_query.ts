import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const today = "2026-05-06";
  const rows = await prisma.$queryRawUnsafe(
    `SELECT e.nombre_principal AS subject, s.nombre_bloque AS room, h.dia_semana::text AS day, TO_CHAR(h.hora_inicio, 'HH24:MI') AS start, TO_CHAR(h.hora_fin, 'HH24:MI') AS end, TO_CHAR(e.fecha_inicio, 'YYYY-MM-DD') AS start_date, TO_CHAR(e.fecha_fin, 'YYYY-MM-DD') AS end_date FROM public.eventos e INNER JOIN public.horarios_evento h ON h.evento_id = e.id INNER JOIN public.salones s ON s.id = h.salon_id WHERE e.fecha_fin < '${today}'::date ORDER BY e.fecha_fin DESC LIMIT 20`,
  );

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
