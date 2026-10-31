# Gestor de Tienda — POS, inventario, créditos y catálogo (con login y nube)

App offline-first (APK Android + escritorio Windows/Mac/Linux + web) con servidor propio de sincronización.
Personalizable por tienda (logo, colores) mediante `www/config.js`.

## 1. Nube con Supabase (recomendado, gratis, sin servidor que mantener)
1. Crea un proyecto en supabase.com (región cercana). Guarda la contraseña de la base de datos.
2. **Authentication > Providers > Email**: desactiva **"Confirm email"** (necesario para que el dueño cree empleados desde la app).
3. **SQL Editor > New query**: pega todo `supabase/schema.sql` y pulsa **Run**.
4. **Authentication > Users > Add user**: crea el correo y la contraseña del dueño, marcando **Auto Confirm User**.
5. En el SQL Editor ejecuta (una vez por tienda):
   `select crear_tienda('Tesanz', 'dueno@correo.com', 'Nombre del dueño', 'tesanz');`
6. **Project Settings > API**: copia *Project URL* y la clave *anon public* en `www/config.js` → `supabase: { url, key }`.
7. Compila el APK/.exe (GitHub Actions). El dueño inicia sesión y crea empleados en Ajustes > Equipo.

Seguridad: las tablas no son accesibles directamente (RLS sin políticas); todo pasa por funciones SQL que verifican sesión, tienda y rol. La clave anon es pública por diseño. Nunca pongas la clave `service_role` en la app.
Respaldos: Supabase > Database > Backups (plan gratis: exporta con `pg_dump` periódicamente). Plan gratis: el proyecto se pausa tras 1 semana sin uso.

## 1b. (Alternativa) Servidor propio Node
 (requiere Node 22+, sin dependencias)
```
npm run server                      # http://localhost:3000 (PORT, DB_PATH, WWW_DIR)
node server/admin.js crear-tienda "Tesanz" dueno@correo.com --nombre "Nombre Dueño" --tema tesanz
node server/admin.js listar
node server/admin.js clave dueno@correo.com            # restablecer clave
node server/admin.js desactivar-tienda | activar-tienda
npm test                                               # 20 pruebas de API
```
Docker: `docker build -t bizcontrol . && docker run -d -p 3000:3000 -v bizcontrol:/data bizcontrol`
**Hosting:** necesita disco persistente (VPS, Oracle Cloud Free, Fly/Railway con volumen; NO planes gratis efímeros) y HTTPS (Caddy/nginx). Respalda el archivo `.db` periódicamente.

## 2. Personalizar por cliente
Copia `www/config.example.js` a `www/config.js`: `supabase` (url y key), `tema`, `nombre`, `assets` (logos base64). Los empleados se crean desde Ajustes > Equipo.

## 3. Compilar APK / escritorio
`npm install` → `npx cap add android && npx cap sync` (APK) · `npm run electron:build` (escritorio). O usa el workflow de GitHub Actions `.github/workflows/build.yml`. Supabase ya es HTTPS.

## Límites conocidos
- Sincronización por registro, última escritura gana: dos equipos vendiendo el mismo producto sin conexión pueden descuadrar stock.
- Los empleados ocultan costos en la interfaz, pero sus equipos reciben esos datos.
- Números de factura podrían repetirse si dos equipos facturan offline a la vez.
- La "factura" es un comprobante interno, no fiscal.
- Con Supabase, el dueño no puede cambiar la contraseña de un empleado: si la olvida, desactiva la cuenta y crea otra con otro correo (o cámbiala en Authentication > Users).
- Para entrar sin conexión hace falta haber iniciado sesión antes en ese equipo.
