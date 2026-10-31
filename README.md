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

## Catálogo en vivo (alojado solo)
- El catálogo es `www/catalogo.html`: una página que lee los productos desde Supabase cada vez que se abre (y se refresca sola cada 45 s). No hay que subir nada: lo que agregues, cambies o quites en Inventario aparece ahí.
- Se publica con GitHub Pages desde el workflow (job `pages`). Una sola vez: repo > **Settings > Pages > Source = "GitHub Actions"**.
- Enlace: `https://USUARIO.github.io/REPO/catalogo.html?t=CODIGO` (el código es único por tienda; la app lo muestra en Catálogo y genera el QR). Para otro dominio: `catalogBase` en `www/config.js`.
- Seguridad: solo se publican productos con "Mostrar en el catálogo"; nunca costos ni márgenes. Las fotos se cargan solo cuando se ven.

## Iconos de Android
`scripts/android-icons.py` (lo ejecuta el workflow) genera el icono clásico, redondo y adaptativo desde `assets/icon-foreground.png` y `assets/icon-background.png`, y elimina el icono por defecto de Capacitor.

## Cómo se evitan los conflictos (Supabase)
- **Stock:** cada equipo envía la *diferencia* de stock (no el número final) y el servidor la suma; ventas simultáneas, incluso sin conexión, no se pisan. Un reintento de envío no resta dos veces.
- **Abonos:** los pagos de todos los equipos se unen y el estado (pendiente/pagada) se recalcula. Si un equipo anula la factura, queda anulada.
- **Números de factura:** si dos equipos usan el mismo, el servidor reasigna el siguiente libre.
- **Costos y ganancias:** el servidor NO los envía a los empleados ni les deja modificarlos; la ganancia de sus ventas la calcula el servidor con el costo real.
- **Contraseña de un empleado:** el dueño la cambia en Ajustes > Equipo (se cierran sus sesiones).
- **Tema/colores:** solo el dueño los cambia; todos los equipos se actualizan al sincronizar.

## Límites conocidos
- Si dos equipos anulan la MISMA factura a la vez sin conexión, el stock se repone dos veces.
- La edición de otros campos (nombre, precio…) sigue siendo "gana el último cambio".
- Para entrar sin conexión hace falta haber iniciado sesión antes en ese equipo.
- La "factura" es un comprobante interno, no fiscal.
- Supabase gratis: pausa el proyecto tras 1 semana sin uso; haz copias periódicas.
