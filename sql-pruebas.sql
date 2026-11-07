\set ON_ERROR_STOP 0
\pset tuples_only on
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','dueno@t.com'),('00000000-0000-0000-0000-0000000000b2','emp@t.com');
select public.crear_tienda('Tesanz','dueno@t.com','Dueña','tesanz');
set role authenticated; set request.uid='00000000-0000-0000-0000-0000000000a1';
select public.team_add('00000000-0000-0000-0000-0000000000b2','Emp','employee') ->> 'ok';
-- dueño crea producto con costo
select 'crea prod', public.sync(0,'[{"c":"productos","id":"p1","u":1000,"d":0,"data":{"id":"p1","nombre":"Blusa","stock":10,"costo":8,"margen":60,"precio":20}}]')->>'cursor';
-- sync inicial de ambos
select 'A stock/costo', (select r->'data'->>'stock'||'/'||(r->'data'->>'costo') from jsonb_array_elements(public.sync(0,'[]')->'recs') r where r->>'id'='p1');
set request.uid='00000000-0000-0000-0000-0000000000b2';
select 'EMP ve costo? (debe ser null)', (select r->'data'->>'costo' is null from jsonb_array_elements(public.sync(0,'[]')->'recs') r where r->>'id'='p1');
select 'EMP ve margen? (debe ser null)', (select r->'data'->>'margen' is null from jsonb_array_elements(public.sync(0,'[]')->'recs') r where r->>'id'='p1');
-- 1) venta simultánea: ambos parten de stock 10, cada uno vende 3 y 2
select 'EMP vende 2 -> stock servidor', (select r->'data'->>'stock' from jsonb_array_elements(public.sync(0,'[{"c":"productos","id":"p1","u":2000,"d":0,"ds":-2,"op":"B:2000:10","data":{"id":"p1","nombre":"Blusa","stock":8,"precio":20}}]')->'recs') r where r->>'id'='p1');
set request.uid='00000000-0000-0000-0000-0000000000a1';
select 'A vende 3 (parte de 10) -> servidor', (select r->'data'->>'stock' from jsonb_array_elements(public.sync(0,'[{"c":"productos","id":"p1","u":2100,"d":0,"ds":-3,"op":"A:2100:10","data":{"id":"p1","nombre":"Blusa","stock":7,"costo":8,"margen":60,"precio":20}}]')->'recs') r where r->>'id'='p1');
select 'A reintenta MISMO envío (no debe restar otra vez)', (select r->'data'->>'stock' from jsonb_array_elements(public.sync(0,'[{"c":"productos","id":"p1","u":2100,"d":0,"ds":-3,"op":"A:2100:10","data":{"id":"p1","nombre":"Blusa","stock":7,"costo":8,"margen":60,"precio":20}}]')->'recs') r where r->>'id'='p1');
-- 2) empleado edita producto: costo no se altera
set request.uid='00000000-0000-0000-0000-0000000000b2';
select 'EMP intenta costo=0.01 -> el dueño sigue viendo', (select (select r->'data'->>'costo' from jsonb_array_elements(public.sync(0,'[{"c":"productos","id":"p1","u":3000,"d":0,"ds":0,"op":"B:3000:5","data":{"id":"p1","nombre":"Blusa 2","stock":5,"costo":0.01,"margen":1,"precio":20}}]')->'recs') r where r->>'id'='p1') is null);
set request.uid='00000000-0000-0000-0000-0000000000a1';
select 'dueño: costo real', (select r->'data'->>'costo'||' margen '||(r->'data'->>'margen')||' nombre '||(r->'data'->>'nombre') from jsonb_array_elements(public.sync(0,'[]')->'recs') r where r->>'id'='p1');
-- 3) empleado factura: costo y ganancia los pone el servidor
set request.uid='00000000-0000-0000-0000-0000000000b2';
select 'EMP crea factura F-000001 a crédito', public.sync(0,'[{"c":"facturas","id":"f1","u":4000,"d":0,"data":{"id":"f1","num":"F-000001","total":40,"subtotal":40,"tipo":"CREDITO","estado":"PENDIENTE","clienteId":"c1","items":[{"pid":"p1","qty":2,"precio":20,"costo":0}],"abonos":[{"id":"x1","fecha":"2026-01-01","monto":10}],"ganancia":40}}]')->'rejected';
set request.uid='00000000-0000-0000-0000-0000000000a1';
select 'dueño ve ganancia/costo', (select (r->'data'->>'ganancia')||' / costo item '||(r->'data'->'items'->0->>'costo') from jsonb_array_elements(public.sync(0,'[]')->'recs') r where r->>'id'='f1');
-- 4) número repetido: dueño crea otra F-000001 desde otro equipo
select 'num repetido -> reasignado', (select r->'data'->>'num' from jsonb_array_elements(public.sync(0,'[{"c":"facturas","id":"f2","u":4100,"d":0,"data":{"id":"f2","num":"F-000001","total":20,"tipo":"CONTADO","estado":"PAGADA","items":[],"abonos":[{"id":"y1","fecha":"2026-01-02","monto":20}]}}]')->'recs') r where r->>'id'='f2');
-- 5) abonos simultáneos de dos equipos sobre f1
select 'A abona 15', (select r->'data'->>'estado'||' abonos='||jsonb_array_length(r->'data'->'abonos') from jsonb_array_elements(public.sync(0,'[{"c":"facturas","id":"f1","u":5000,"d":0,"data":{"id":"f1","num":"F-000001","total":40,"tipo":"CREDITO","estado":"PENDIENTE","items":[{"pid":"p1","qty":2,"precio":20,"costo":8}],"ganancia":24,"abonos":[{"id":"x1","fecha":"2026-01-01","monto":10},{"id":"a2","fecha":"2026-01-05","monto":15}]}}]')->'recs') r where r->>'id'='f1');
set request.uid='00000000-0000-0000-0000-0000000000b2';
select 'EMP (viejo, u menor) abona 15 distinto', (select r->'data'->>'estado'||' abonos='||jsonb_array_length(r->'data'->'abonos')||' ganancia='||coalesce(r->'data'->>'ganancia','oculta')||' costoItem='||coalesce(r->'data'->'items'->0->>'costo','oculto') from jsonb_array_elements(public.sync(0,'[{"c":"facturas","id":"f1","u":4500,"d":0,"data":{"id":"f1","num":"F-000001","total":40,"tipo":"CREDITO","estado":"PENDIENTE","items":[{"pid":"p1","qty":2,"precio":20}],"abonos":[{"id":"x1","fecha":"2026-01-01","monto":10},{"id":"b3","fecha":"2026-01-06","monto":15}]}}]')->'recs') r where r->>'id'='f1');
-- 6) clave del empleado
set request.uid='00000000-0000-0000-0000-0000000000a1';
reset role; insert into auth.sessions(user_id) values ('00000000-0000-0000-0000-0000000000b2'); set role authenticated; set request.uid='00000000-0000-0000-0000-0000000000a1';
select 'set pw', public.team_set_password('00000000-0000-0000-0000-0000000000b2','NuevaClave99');
reset role; select 'hash bcrypt valido', encrypted_password = extensions.crypt('NuevaClave99', encrypted_password), 'sesiones', (select count(*) from auth.sessions) from auth.users where email='emp@t.com';
set role authenticated; set request.uid='00000000-0000-0000-0000-0000000000b2';
select 'EMP no puede cambiar clave ajena', public.team_set_password('00000000-0000-0000-0000-0000000000a1','NuevaClave99');
