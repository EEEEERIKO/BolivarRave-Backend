-- Reservation requests for the /reservas page (rooms and equipment).

create table if not exists public.reservas_solicitudes (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  resource_id text not null,
  resource_label text not null,
  resource_context text,
  resource_code text,
  resource_description text,
  resource_original_room_id text,
  resource_original_room_label text,
  destination_room_id text,
  destination_room_label text,
  booking_date date not null,
  start_time time not null,
  end_time time not null,
  purpose text not null,
  requester_name text not null,
  requester_document text not null,
  requester_email text,
  requester_phone text,
  terms_accepted boolean not null default true,
  status text not null default 'pendiente',
  returned_at timestamptz,
  created_by_staff_id uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservas_solicitudes_resource_type_chk check (resource_type in ('rooms', 'equipment')),
  constraint reservas_solicitudes_status_chk check (status in ('pendiente', 'aprobada', 'rechazada', 'cancelada', 'devuelto')),
  constraint reservas_solicitudes_time_chk check (end_time > start_time),
  constraint reservas_solicitudes_destination_chk check (
    (resource_type = 'rooms' and destination_room_id is null and destination_room_label is null)
    or
    (resource_type = 'equipment' and destination_room_id is not null and destination_room_label is not null)
  )
);

create index if not exists idx_reservas_solicitudes_resource_type on public.reservas_solicitudes(resource_type);
create index if not exists idx_reservas_solicitudes_booking_date on public.reservas_solicitudes(booking_date);
create index if not exists idx_reservas_solicitudes_status on public.reservas_solicitudes(status);
create index if not exists idx_reservas_solicitudes_created_by on public.reservas_solicitudes(created_by_staff_id);