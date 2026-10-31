-- =====================================================================
-- Gestor de Tienda — esquema para Supabase (Postgres)
-- Pegar COMPLETO en: Supabase > SQL Editor > New query > Run. Se puede repetir sin problema.
-- Seguridad: las tablas tienen RLS activado SIN políticas => nadie las toca directo;
-- toda la lectura/escritura pasa por las funciones de abajo, que verifican quién eres.
-- =====================================================================
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  active boolean not null default true,
  seq bigint not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  nombre text not null,
  rol text not null default 'employee' check (rol in ('owner','employee')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists profiles_store_idx on public.profiles(store_id);
create table if not exists public.records (
  store_id uuid not null references public.stores(id) on delete cascade,
  col text not null,
  id text not null,
  u bigint not null,          -- marca de tiempo (ms) del cambio: gana la más reciente
  del boolean not null default false,
  data jsonb,
  seq bigint not null,
  primary key (store_id, col, id)
);
create index if not exists records_seq_idx on public.records(store_id, seq);
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.records enable row level security;

-- Perfil activo del usuario que llama (o error si está desactivado)
create or replace function public._me() returns public.profiles
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found or not p.active or not exists (select 1 from public.stores s where s.id = p.store_id and s.active) then
    raise exception 'cuenta_desactivada' using errcode = 'P0401';
  end if;
  return p;
end $$;

create or replace function public.me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles; s public.stores; em text;
begin
  p := public._me();
  select * into s from public.stores where id = p.store_id;
  select email into em from auth.users where id = p.id;
  return jsonb_build_object('user', jsonb_build_object('id', p.id, 'email', em, 'nombre', p.nombre, 'rol', p.rol),
                            'store', jsonb_build_object('id', s.id, 'nombre', s.nombre));
end $$;

-- Sincronización: recibe cambios (push) y devuelve lo nuevo desde 'since'
create or replace function public.sync(since bigint, push jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles; it jsonb; c text; rid text; uu bigint; dd boolean; ex public.records;
  cur bigint; rej jsonb := '[]'::jsonb; den jsonb := '[]'::jsonb; mine text[] := '{}';
  recs jsonb := '[]'::jsonb; rows jsonb; n int; lim int := 400; more boolean := false; lastseq bigint; r record;
begin
  p := public._me();
  select seq into cur from public.stores where id = p.store_id for update; -- serializa por tienda
  for it in select * from jsonb_array_elements(coalesce(push, '[]'::jsonb)) loop
    c := it->>'c'; rid := it->>'id';
    if c is null or rid is null or length(rid) > 80 or c not in ('productos','clientes','facturas','movs','categorias','config') then continue; end if;
    begin uu := (it->>'u')::bigint; exception when others then continue; end;
    if c in ('categorias','config') and p.rol <> 'owner' then den := den || jsonb_build_array(jsonb_build_object('c', c, 'id', rid)); continue; end if;
    select * into ex from public.records where store_id = p.store_id and col = c and id = rid;
    if found and ex.u > uu then rej := rej || jsonb_build_array(jsonb_build_object('c', c, 'id', rid)); continue; end if;
    dd := coalesce((it->>'d')::int, 0) = 1 or coalesce(it->>'d','') = 'true';
    if not dd and length((it->'data')::text) > 6000000 then continue; end if;
    cur := cur + 1;
    insert into public.records (store_id, col, id, u, del, data, seq)
    values (p.store_id, c, rid, uu, dd, case when dd then null else it->'data' end, cur)
    on conflict (store_id, col, id) do update set u = excluded.u, del = excluded.del, data = excluded.data, seq = excluded.seq;
    mine := mine || (c || '|' || rid);
  end loop;
  update public.stores set seq = cur where id = p.store_id;

  n := 0;
  for r in select col, id, u, del, data, seq from public.records where store_id = p.store_id and seq > since order by seq limit lim + 1 loop
    n := n + 1;
    if n > lim then more := true; exit; end if;
    lastseq := r.seq;
    if not ((r.col || '|' || r.id) = any(mine)) then
      recs := recs || jsonb_build_array(jsonb_build_object('c', r.col, 'id', r.id, 'u', r.u, 'd', r.del, 'data', case when r.del then null else r.data end));
    end if;
  end loop;
  -- rechazados: devolver la versión ganadora del servidor
  for it in select * from jsonb_array_elements(rej) loop
    select * into ex from public.records where store_id = p.store_id and col = it->>'c' and id = it->>'id';
    if found and not (recs @> jsonb_build_array(jsonb_build_object('c', ex.col, 'id', ex.id))) then
      recs := recs || jsonb_build_array(jsonb_build_object('c', ex.col, 'id', ex.id, 'u', ex.u, 'd', ex.del, 'data', case when ex.del then null else ex.data end));
    end if;
  end loop;
  return jsonb_build_object('cursor', case when more then lastseq else cur end, 'more', more, 'recs', recs,
                            'rejected', rej, 'denied', den, 'serverTime', (extract(epoch from clock_timestamp()) * 1000)::bigint);
end $$;

-- Equipo (solo dueño)
create or replace function public.team_list() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  p := public._me();
  if p.rol <> 'owner' then raise exception 'Solo el dueño puede administrar usuarios'; end if;
  return jsonb_build_object('users', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'email', a.email, 'nombre', f.nombre, 'rol', f.rol, 'active', f.active) order by f.created_at)
    from public.profiles f join auth.users a on a.id = f.id where f.store_id = p.store_id), '[]'::jsonb));
end $$;

-- Enlaza a la tienda del dueño una cuenta recién creada (signup) — válida por 15 min
create or replace function public.team_add(uid uuid, nombre text, rol text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  p := public._me();
  if p.rol <> 'owner' then raise exception 'Solo el dueño puede administrar usuarios'; end if;
  if rol not in ('owner','employee') then rol := 'employee'; end if;
  if not exists (select 1 from auth.users where id = uid and created_at > now() - interval '15 minutes') then raise exception 'Cuenta no válida'; end if;
  if exists (select 1 from public.profiles where id = uid) then raise exception 'Ese correo ya está registrado'; end if;
  insert into public.profiles (id, store_id, nombre, rol) values (uid, p.store_id, btrim(nombre), rol);
  return jsonb_build_object('ok', true, 'id', uid);
end $$;

create or replace function public.team_update(uid uuid, nombre text, rol text, active boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  p := public._me();
  if p.rol <> 'owner' then raise exception 'Solo el dueño puede administrar usuarios'; end if;
  if uid = p.id and (active is false or rol <> 'owner') then raise exception 'No puedes quitarte el acceso a ti mismo'; end if;
  update public.profiles set nombre = coalesce(nullif(btrim(team_update.nombre), ''), public.profiles.nombre),
    rol = case when team_update.rol in ('owner','employee') then team_update.rol else public.profiles.rol end,
    active = coalesce(team_update.active, public.profiles.active)
  where id = uid and store_id = p.store_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Crear una tienda (la ejecutas TÚ desde el SQL Editor). Antes crea el usuario dueño en
-- Authentication > Users > Add user (marca "Auto Confirm User").
create or replace function public.crear_tienda(nombre_tienda text, email_dueno text, nombre_dueno text, tema text default 'indigo') returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid; sid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(btrim(email_dueno));
  if uid is null then raise exception 'Primero crea el usuario % en Authentication > Users', email_dueno; end if;
  if exists (select 1 from public.profiles where id = uid) then raise exception 'Ese usuario ya pertenece a una tienda'; end if;
  insert into public.stores (nombre, seq) values (nombre_tienda, 1) returning id into sid;
  insert into public.profiles (id, store_id, nombre, rol) values (uid, sid, nombre_dueno, 'owner');
  insert into public.records (store_id, col, id, u, del, data, seq)
  values (sid, 'config', 'config', (extract(epoch from now()) * 1000)::bigint, false, jsonb_build_object('nombre', nombre_tienda, 'tema', tema), 1);
  return 'Tienda creada: ' || sid::text;
end $$;

-- Permisos: solo usuarios con sesión pueden llamar a las funciones de la app
revoke all on function public._me() from public, anon, authenticated;
revoke all on function public.crear_tienda(text, text, text, text) from public, anon, authenticated;
revoke all on function public.me() from public, anon;
revoke all on function public.sync(bigint, jsonb) from public, anon;
revoke all on function public.team_list() from public, anon;
revoke all on function public.team_add(uuid, text, text) from public, anon;
revoke all on function public.team_update(uuid, text, text, boolean) from public, anon;
grant execute on function public.me(), public.sync(bigint, jsonb), public.team_list(),
  public.team_add(uuid, text, text), public.team_update(uuid, text, text, boolean) to authenticated;
