-- Consolidacion de salones duplicados hacia catalogo oficial
-- Mueve horarios de salones "duplicados" al salon canonico y elimina duplicados.

begin;

-- Mapa source -> target
with mapping(source_name, target_name) as (
  values
    ('Salón 506 MD', 'Salón 506'),
    ('Salón 505 MD', 'Salón 505'),
    ('Salón 402 MD', 'Salón 402'),
    ('Salón 401 MD', 'Salón 401'),
    ('Salón 304 MD', 'Salón 304'),
    ('Salón 301 MD', 'Salón 301'),
    ('Aula Foro Unión 101', 'Aula Foro Union 101'),
    ('Aula Foro UNAC 102', 'Aula Foro Unac 102')
),
ids as (
  select
    m.source_name,
    m.target_name,
    ss.id as source_id,
    st.id as target_id
  from mapping m
  left join public.salones ss on ss.nombre_bloque = m.source_name
  left join public.salones st on st.nombre_bloque = m.target_name
)
update public.horarios_evento h
set salon_id = ids.target_id
from ids
where h.salon_id = ids.source_id
  and ids.source_id is not null
  and ids.target_id is not null;

-- Eliminar salones fuente duplicados (si existen)
with mapping(source_name, target_name) as (
  values
    ('Salón 506 MD', 'Salón 506'),
    ('Salón 505 MD', 'Salón 505'),
    ('Salón 402 MD', 'Salón 402'),
    ('Salón 401 MD', 'Salón 401'),
    ('Salón 304 MD', 'Salón 304'),
    ('Salón 301 MD', 'Salón 301'),
    ('Aula Foro Unión 101', 'Aula Foro Union 101'),
    ('Aula Foro UNAC 102', 'Aula Foro Unac 102')
)
delete from public.salones s
using mapping m
where s.nombre_bloque = m.source_name;

commit;
