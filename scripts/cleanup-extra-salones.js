const { prisma } = require('../dist/lib/prisma');

const OFFICIAL_ROOMS = [
  { nombre: 'Sala Informática 1 Bolivar', capacidad: 25, piso: 1 },
  { nombre: 'Aula Foro Unac 102', capacidad: 60, piso: 1 },
  { nombre: 'Aula Foro Unión 101', capacidad: 60, piso: 1 },
  { nombre: 'Sala Informática 2 Bolivar', capacidad: 25, piso: 1 },
  { nombre: 'Salón 205', capacidad: 46, piso: 2 },
  { nombre: 'Salón 201', capacidad: 40, piso: 2 },
  { nombre: 'Salón 202', capacidad: 40, piso: 2 },
  { nombre: 'Salón 203', capacidad: 40, piso: 2 },
  { nombre: 'Laboratorio de Infantil 204', capacidad: 40, piso: 2 },
  { nombre: 'Salón 206', capacidad: 40, piso: 2 },
  { nombre: 'Salón 302', capacidad: 62, piso: 3 },
  { nombre: 'Salón 303', capacidad: 48, piso: 3 },
  { nombre: 'Salón 304', capacidad: 40, piso: 3 },
  { nombre: 'Laboratorio de Música 308', capacidad: 40, piso: 3 },
  { nombre: 'Salón 305', capacidad: 69, piso: 3 },
  { nombre: 'Salón 301', capacidad: 40, piso: 3 },
  { nombre: 'Laboratorio de Desarrollo de Software (LDS) 404', capacidad: 40, piso: 4 },
  { nombre: 'Laboratorio de análisis de datos y simulación financiera 403', capacidad: 40, piso: 4 },
  { nombre: 'Salón 406', capacidad: 42, piso: 4 },
  { nombre: 'Salón 401', capacidad: 40, piso: 4 },
  { nombre: 'Salón 402', capacidad: 45, piso: 4 },
  { nombre: 'Laboratorio Múltiple de Física 405', capacidad: 44, piso: 4 },
  { nombre: 'Salón 506', capacidad: 40, piso: 5 },
  { nombre: 'Aula Interamericana 502', capacidad: 55, piso: 5 },
  { nombre: 'Aula Interamericana 501', capacidad: 55, piso: 5 },
  { nombre: 'Salón 505', capacidad: 50, piso: 5 },
  { nombre: 'Aula Interamericana 503', capacidad: 55, piso: 5 },
];

const OFFICIAL_ROOM_NAMES = OFFICIAL_ROOMS.map((r) => r.nombre);

async function main() {
  for (const room of OFFICIAL_ROOMS) {
    await prisma.$executeRaw`
      INSERT INTO public.salones (nombre_bloque, capacidad, piso)
      VALUES (${room.nombre}, ${room.capacidad}, ${room.piso})
      ON CONFLICT (nombre_bloque) DO UPDATE
      SET
        capacidad = EXCLUDED.capacidad,
        piso = EXCLUDED.piso
    `;
  }

  const before = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM public.salones) AS salones,
      (SELECT COUNT(*)::int FROM public.horarios_evento) AS horarios,
      (SELECT COUNT(*)::int FROM public.eventos) AS eventos
  `);

  const extras = await prisma.$queryRawUnsafe(
    `SELECT id::text AS id, nombre_bloque AS nombre FROM public.salones WHERE nombre_bloque <> ALL($1::text[]) ORDER BY nombre_bloque`,
    OFFICIAL_ROOM_NAMES
  );

  const extraIds = extras.map((r) => r.id);

  let deletedHorarios = 0;
  let deletedSalones = 0;
  let deletedOrphanEvents = 0;

  await prisma.$transaction(async (tx) => {
    if (extraIds.length > 0) {
      const horariosResult = await tx.$queryRawUnsafe(
        `DELETE FROM public.horarios_evento WHERE salon_id = ANY($1::uuid[]) RETURNING id::text AS id`,
        extraIds
      );
      deletedHorarios = horariosResult.length;

      const salonesResult = await tx.$queryRawUnsafe(
        `DELETE FROM public.salones WHERE id = ANY($1::uuid[]) RETURNING id::text AS id`,
        extraIds
      );
      deletedSalones = salonesResult.length;
    }

    const orphanEvents = await tx.$queryRawUnsafe(`
      DELETE FROM public.eventos e
      WHERE NOT EXISTS (
        SELECT 1 FROM public.horarios_evento h WHERE h.evento_id = e.id
      )
      RETURNING e.id::text AS id
    `);
    deletedOrphanEvents = orphanEvents.length;
  });

  const after = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM public.salones) AS salones,
      (SELECT COUNT(*)::int FROM public.horarios_evento) AS horarios,
      (SELECT COUNT(*)::int FROM public.eventos) AS eventos
  `);

  const currentRooms = await prisma.$queryRawUnsafe(`
    SELECT nombre_bloque AS nombre
    FROM public.salones
  `);
  const currentRoomSet = new Set(currentRooms.map((r) => r.nombre));
  const missingOfficialRooms = OFFICIAL_ROOM_NAMES.filter((name) => !currentRoomSet.has(name));

  console.log(
    JSON.stringify(
      {
        before: before[0],
        extraSalonesDetected: extras.length,
        deleted: {
          horarios: deletedHorarios,
          salones: deletedSalones,
          orphanEvents: deletedOrphanEvents,
        },
        after: after[0],
        missingOfficialRooms,
        sampleRemoved: extras.slice(0, 20),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
