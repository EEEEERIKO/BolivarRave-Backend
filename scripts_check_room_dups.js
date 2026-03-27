const { Client } = require('./node_modules/pg');
require('dotenv').config();

const normalizeName = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const rows = (
    await c.query('select id::text as id, nombre_bloque from public.salones order by nombre_bloque')
  ).rows;

  const groups = new Map();
  for (const r of rows) {
    const key = normalizeName(r.nombre_bloque);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const dup = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  console.log('DUP_GROUPS', dup.length);

  for (const [key, arr] of dup) {
    if (key.includes('aula foro union') || key.includes('aula foro unac')) {
      console.log('KEY', key);
      arr.forEach((x) => console.log('-', x.id, x.nombre_bloque));
    }
  }

  await c.end();
})();
