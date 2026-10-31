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
alter table public.stores add column if not exists slug text;
create unique index if not exists stores_slug_idx on public.stores(slug);
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
  if s.slug is null then
    update public.stores set slug = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10) where id = s.id returning * into s;
  end if;
  select email into em from auth.users where id = p.id;
  return jsonb_build_object('user', jsonb_build_object('id', p.id, 'email', em, 'nombre', p.nombre, 'rol', p.rol),
                            'store', jsonb_build_object('id', s.id, 'nombre', s.nombre, 'slug', s.slug));
end $$;

-- Columna para evitar aplicar dos veces un mismo cambio de stock si se reintenta un envío
alter table public.records add column if not exists op text;

-- Datos que un empleado NO debe recibir (costos y márgenes)
create or replace function public._strip(col text, d jsonb) returns jsonb
language plpgsql immutable as $$
begin
  if d is null then return d; end if;
  if col = 'productos' then return d - 'costo' - 'margen'; end if;
  if col = 'facturas' then
    return (d - 'ganancia') || jsonb_build_object('items', coalesce((select jsonb_agg(i - 'costo') from jsonb_array_elements(coalesce(d->'items', '[]'::jsonb)) i), '[]'::jsonb));
  end if;
  return d;
end $$;

-- Une los abonos de dos versiones de una factura y recalcula su estado
create or replace function public._merge_factura(base jsonb, other jsonb) returns jsonb
language plpgsql immutable as $$
declare ab jsonb; pag numeric; tot numeric; est text;
begin
  select coalesce(jsonb_agg(a order by a->>'fecha'), '[]'::jsonb) into ab from (
    select distinct on (a->>'id') a from (
      select jsonb_array_elements(coalesce(base->'abonos', '[]'::jsonb)) a union all select jsonb_array_elements(coalesce(other->'abonos', '[]'::jsonb))) x
    order by a->>'id') y;
  select coalesce(sum((a->>'monto')::numeric), 0) into pag from jsonb_array_elements(ab) a;
  tot := coalesce((base->>'total')::numeric, 0);
  est := case when base->>'estado' = 'ANULADA' or other->>'estado' = 'ANULADA' then 'ANULADA'
              when tot - pag <= 0.004 then 'PAGADA' else 'PENDIENTE' end;
  return base || jsonb_build_object('abonos', ab, 'estado', est);
end $$;

-- Sincronización: recibe cambios (push) y devuelve lo nuevo desde 'since'.
--  · Stock: se envía como DIFERENCIA (ds) y se suma al stock del servidor → dos equipos vendiendo a la vez no se pisan.
--  · Facturas: los abonos de todos los equipos se unen; un equipo que anula, anula.
--  · Empleados: no reciben costos ni márgenes, y no pueden alterarlos.
create or replace function public.sync(since bigint, push jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles; it jsonb; c text; rid text; uu bigint; dd boolean; ex public.records; found_ex boolean; stale boolean;
  nd jsonb; ds numeric; opid text; isowner boolean; cur bigint; rej jsonb := '[]'::jsonb; den jsonb := '[]'::jsonb; mine text[] := '{}';
  recs jsonb := '[]'::jsonb; more boolean := false; lastseq bigint; r record; n int; lim int := 400; mx int; costo numeric; gan numeric; itm jsonb; items jsonb; k text; val jsonb;
begin
  p := public._me(); isowner := p.rol = 'owner';
  select seq into cur from public.stores where id = p.store_id for update; -- serializa por tienda
  for it in select * from jsonb_array_elements(coalesce(push, '[]'::jsonb)) loop
    c := it->>'c'; rid := it->>'id';
    if c is null or rid is null or length(rid) > 80 or c not in ('productos','clientes','facturas','movs','gastos','cierres','categorias','config') then continue; end if;
    begin uu := (it->>'u')::bigint; exception when others then continue; end;
    if c in ('categorias','config') and not isowner then den := den || jsonb_build_array(jsonb_build_object('c', c, 'id', rid)); continue; end if;
    dd := coalesce(it->>'d', '0') in ('1', 'true');
    if not dd and length((it->'data')::text) > 6000000 then continue; end if;
    select * into ex from public.records where store_id = p.store_id and col = c and id = rid;
    found_ex := found; stale := found_ex and ex.u > uu;
    nd := case when dd then null else it->'data' end; opid := null; val := null;
    ds := case when jsonb_typeof(it->'ds') = 'number' then (it->>'ds')::numeric else null end;

    if not dd and c = 'productos' then
      if found_ex and not ex.del and ex.data is not null then
        if ds is not null then
          if ex.op is not distinct from (it->>'op') and (it->>'op') is not null then ds := 0; end if; -- reintento ya aplicado
          opid := it->>'op';
          if stale then nd := ex.data; end if;
          nd := jsonb_set(nd, '{stock}', to_jsonb(coalesce((ex.data->>'stock')::numeric, 0) + ds));
          if stale then uu := ex.u; end if;
          val := nd; -- se devuelve al equipo que envió
        end if;
        if not isowner then nd := nd || jsonb_build_object('costo', coalesce(ex.data->'costo', '0'::jsonb), 'margen', coalesce(ex.data->'margen', '0'::jsonb)); end if;
      elsif not isowner then nd := nd || jsonb_build_object('costo', 0, 'margen', 0);
      end if;
    elsif not dd and c = 'facturas' then
      if found_ex and not ex.del and ex.data is not null then
        if not isowner or stale then
          -- se conservan los montos y costos del servidor; solo se fusionan abonos y estado
          nd := public._merge_factura(ex.data, nd);
        else
          nd := public._merge_factura(nd, ex.data);
        end if;
        if stale then uu := ex.u; end if;
        val := nd;
      else
        -- número de factura repetido entre equipos → se reasigna el siguiente libre
        if exists (select 1 from public.records f where f.store_id = p.store_id and f.col = 'facturas' and f.id <> rid and not f.del and f.data->>'num' = nd->>'num') then
          select coalesce(max(nullif(regexp_replace(f.data->>'num', '\D', '', 'g'), '')::int), 0) into mx from public.records f where f.store_id = p.store_id and f.col = 'facturas' and not f.del;
          nd := jsonb_set(nd, '{num}', to_jsonb('F-' || lpad((mx + 1)::text, 6, '0'))); val := nd;
        end if;
        if not isowner then -- costos reales desde el inventario del servidor
          items := '[]'::jsonb; gan := 0;
          for itm in select * from jsonb_array_elements(coalesce(nd->'items', '[]'::jsonb)) loop
            select coalesce((x.data->>'costo')::numeric, 0) into costo from public.records x where x.store_id = p.store_id and x.col = 'productos' and x.id = itm->>'pid' and not x.del;
            costo := coalesce(costo, 0); gan := gan + costo * coalesce((itm->>'qty')::numeric, 0);
            items := items || jsonb_build_array(itm || jsonb_build_object('costo', costo));
          end loop;
          nd := nd || jsonb_build_object('items', items, 'ganancia', round(coalesce((nd->>'total')::numeric, 0) - gan, 2)); val := nd;
        end if;
      end if;
    elsif stale then
      rej := rej || jsonb_build_array(jsonb_build_object('c', c, 'id', rid)); continue;
    end if;

    if stale and val is null then rej := rej || jsonb_build_array(jsonb_build_object('c', c, 'id', rid)); continue; end if;
    cur := cur + 1;
    insert into public.records (store_id, col, id, u, del, data, seq, op)
    values (p.store_id, c, rid, uu, dd, nd, cur, opid)
    on conflict (store_id, col, id) do update set u = excluded.u, del = excluded.del, data = excluded.data, seq = excluded.seq, op = coalesce(excluded.op, public.records.op);
    if val is null then mine := mine || (c || '|' || rid); end if;
  end loop;
  update public.stores set seq = cur where id = p.store_id;

  n := 0;
  for r in select col, id, u, del, data, seq from public.records where store_id = p.store_id and seq > since order by seq limit lim + 1 loop
    n := n + 1;
    if n > lim then more := true; exit; end if;
    lastseq := r.seq;
    if not ((r.col || '|' || r.id) = any(mine)) then
      recs := recs || jsonb_build_array(jsonb_build_object('c', r.col, 'id', r.id, 'u', r.u, 'd', r.del,
        'data', case when r.del then null when isowner then r.data else public._strip(r.col, r.data) end));
    end if;
  end loop;
  -- rechazados: devolver la versión ganadora del servidor
  for it in select * from jsonb_array_elements(rej) loop
    select * into ex from public.records where store_id = p.store_id and col = it->>'c' and id = it->>'id';
    if found and not (recs @> jsonb_build_array(jsonb_build_object('c', ex.col, 'id', ex.id))) then
      recs := recs || jsonb_build_array(jsonb_build_object('c', ex.col, 'id', ex.id, 'u', ex.u, 'd', ex.del,
        'data', case when ex.del then null when isowner then ex.data else public._strip(ex.col, ex.data) end));
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

-- El dueño cambia la contraseña de un empleado (y se cierran sus sesiones)
create or replace function public.team_set_password(uid uuid, nueva text) returns jsonb
language plpgsql security definer set search_path = public, extensions, auth as $$
declare p public.profiles;
begin
  p := public._me();
  if p.rol <> 'owner' then raise exception 'Solo el dueño puede administrar usuarios'; end if;
  if uid = p.id then raise exception 'Cambia tu propia contraseña desde Mi cuenta'; end if;
  if length(coalesce(nueva, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  if not exists (select 1 from public.profiles where id = uid and store_id = p.store_id) then raise exception 'Usuario no encontrado'; end if;
  update auth.users set encrypted_password = extensions.crypt(nueva, extensions.gen_salt('bf')), updated_at = now() where id = uid;
  delete from auth.sessions where user_id = uid;
  return jsonb_build_object('ok', true);
end $$;

-- ===== Respaldos automáticos (copias diarias dentro de Supabase; sin fotos, para ahorrar espacio) =====
create table if not exists public.backups (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  tipo text not null default 'auto',
  n int not null default 0,
  store_seq bigint not null default 0,
  data jsonb not null
);
create index if not exists backups_store_idx on public.backups(store_id, created_at desc);
alter table public.backups enable row level security;

create or replace function public._backup_store(sid uuid, tp text) returns bigint
language plpgsql security definer set search_path = public as $$
declare bid bigint; sq bigint; cnt int;
begin
  select seq into sq from public.stores where id = sid;
  insert into public.backups (store_id, tipo, n, store_seq, data)
  select sid, tp, count(*), sq,
         coalesce(jsonb_agg(jsonb_build_object('c', col, 'id', id, 'data', case when col = 'productos' then data - 'imagenes' else data end)), '[]'::jsonb)
  from public.records where store_id = sid and not del
  returning id into bid;
  -- se conservan las 30 más recientes por tienda
  delete from public.backups where store_id = sid and id not in (select id from public.backups where store_id = sid order by created_at desc, id desc limit 30);
  return bid;
end $$;

-- La ejecuta el programador diario (pg_cron). Solo copia tiendas con cambios desde la última copia.
create or replace function public.crear_respaldos_auto() returns int
language plpgsql security definer set search_path = public as $$
declare st record; n int := 0; lastseq bigint;
begin
  for st in select id, seq from public.stores where active loop
    select store_seq into lastseq from public.backups where store_id = st.id order by created_at desc, id desc limit 1;
    if lastseq is null or lastseq <> st.seq then perform public._backup_store(st.id, 'auto'); n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.respaldo_crear() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  p := public._me();
  if p.rol <> 'owner' then raise exception 'Solo el dueño puede gestionar respaldos'; end if;
  return jsonb_build_object('id', public._backup_store(p.store_id, 'manual'));
end $$;

create or replace function public.respaldos_lista() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  p := public._me();
  if p.rol <> 'owner' then raise exception 'Solo el dueño puede gestionar respaldos'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'fecha', b.created_at, 'tipo', b.tipo, 'n', b.n) order by b.created_at desc, b.id desc)
                   from (select * from public.backups where store_id = p.store_id order by created_at desc, id desc limit 30) b), '[]'::jsonb);
end $$;

-- Restaura una copia: antes guarda una copia de seguridad del estado actual. Las fotos actuales se conservan.
create or replace function public.respaldo_restaurar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles; b public.backups; e jsonb; cur bigint; nowms bigint; c text; rid text; d jsonb; imgs jsonb; kept text[] := '{}'; ncnt int := 0; r record;
begin
  p := public._me();
  if p.rol <> 'owner' then raise exception 'Solo el dueño puede gestionar respaldos'; end if;
  select * into b from public.backups where id = p_id and store_id = p.store_id;
  if not found then raise exception 'Respaldo no encontrado'; end if;
  perform public._backup_store(p.store_id, 'antes-de-restaurar');
  select seq into cur from public.stores where id = p.store_id for update;
  nowms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  for e in select * from jsonb_array_elements(b.data) loop
    c := e->>'c'; rid := e->>'id'; d := e->'data';
    if c = 'productos' then
      select x.data->'imagenes' into imgs from public.records x where x.store_id = p.store_id and x.col = 'productos' and x.id = rid and not x.del;
      d := d || jsonb_build_object('imagenes', coalesce(imgs, '[]'::jsonb));
    end if;
    cur := cur + 1;
    insert into public.records (store_id, col, id, u, del, data, seq) values (p.store_id, c, rid, nowms, false, d, cur)
    on conflict (store_id, col, id) do update set u = excluded.u, del = false, data = excluded.data, seq = excluded.seq;
    kept := kept || (c || '|' || rid); ncnt := ncnt + 1;
  end loop;
  for r in select col, id from public.records where store_id = p.store_id and not del loop
    if not ((r.col || '|' || r.id) = any(kept)) then
      cur := cur + 1;
      update public.records set del = true, data = null, u = nowms, seq = cur where store_id = p.store_id and col = r.col and id = r.id;
    end if;
  end loop;
  update public.stores set seq = cur where id = p.store_id;
  return jsonb_build_object('ok', true, 'restaurados', ncnt);
end $$;

-- Programación diaria (07:00 UTC). Si tu proyecto no permite pg_cron, activa Database > Extensions > pg_cron y vuelve a ejecutar este script.
do $$ begin
  begin create extension if not exists pg_cron;
  exception when others then raise notice 'pg_cron no disponible: actívalo en Database > Extensions'; end;
  begin perform cron.schedule('respaldo-diario', '0 7 * * *', 'select public.crear_respaldos_auto()');
  exception when others then raise notice 'No se pudo programar el respaldo diario (pg_cron)'; end;
end $$;

-- ===== Catálogo público en vivo (lo lee cualquiera con el enlace; nunca incluye costos) =====
create or replace function public.catalogo_publico(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.stores; cfg jsonb; cats jsonb; prods jsonb;
begin
  select * into s from public.stores where slug = p_slug and active;
  if not found then return null; end if;
  select data into cfg from public.records where store_id = s.id and col = 'config' and id = 'config' and not del;
  select data into cats from public.records where store_id = s.id and col = 'categorias' and id = 'categorias' and not del;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'nombre', r.data->>'nombre', 'categoria', r.data->>'categoria', 'variante', r.data->>'variante',
           'precio', r.data->'precio', 'stock', r.data->'stock', 'minimo', r.data->'minimo', 'desc', r.data->>'desc',
           'nimg', coalesce(jsonb_array_length(case when jsonb_typeof(r.data->'imagenes') = 'array' then r.data->'imagenes' end), 0)) order by r.data->>'nombre'), '[]'::jsonb)
    into prods from public.records r
    where r.store_id = s.id and r.col = 'productos' and not r.del and coalesce(r.data->>'catalogo', 'true') <> 'false';
  return jsonb_build_object('tienda', coalesce(cfg, '{}'::jsonb) - 'catalogUrl' - 'idFiscal', 'categorias', coalesce(cats, '[]'::jsonb), 'productos', prods);
end $$;

create or replace function public.catalogo_imagenes(p_slug text, p_pid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.stores; im jsonb;
begin
  select * into s from public.stores where slug = p_slug and active;
  if not found then return '[]'::jsonb; end if;
  select r.data->'imagenes' into im from public.records r
    where r.store_id = s.id and r.col = 'productos' and r.id = p_pid and not r.del and coalesce(r.data->>'catalogo', 'true') <> 'false';
  return case when jsonb_typeof(im) = 'array' then im else '[]'::jsonb end;
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
revoke all on function public.catalogo_publico(text) from public;
revoke all on function public.catalogo_imagenes(text, text) from public;
revoke all on function public.me() from public, anon;
revoke all on function public.sync(bigint, jsonb) from public, anon;
revoke all on function public.team_list() from public, anon;
revoke all on function public.team_add(uuid, text, text) from public, anon;
revoke all on function public.team_update(uuid, text, text, boolean) from public, anon;
revoke all on function public.team_set_password(uuid, text) from public, anon;
revoke all on function public._backup_store(uuid, text) from public, anon, authenticated;
revoke all on function public.crear_respaldos_auto() from public, anon, authenticated;
revoke all on function public.respaldo_crear() from public, anon;
revoke all on function public.respaldos_lista() from public, anon;
revoke all on function public.respaldo_restaurar(bigint) from public, anon;
revoke all on function public._strip(text, jsonb) from public, anon, authenticated;
revoke all on function public._merge_factura(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.catalogo_publico(text), public.catalogo_imagenes(text, text) to anon, authenticated;
grant execute on function public.me(), public.sync(bigint, jsonb), public.team_list(),
  public.team_add(uuid, text, text), public.team_update(uuid, text, text, boolean), public.team_set_password(uuid, text), public.respaldo_crear(), public.respaldos_lista(), public.respaldo_restaurar(bigint) to authenticated;
