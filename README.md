# Gestor de Tienda — POS, inventario, créditos y catálogo (con login y nube)

App offline-first (APK Android + escritorio Windows/Mac/Linux + web) con servidor propio de sincronización.
Personalizable por tienda (logo, colores) mediante `www/config.js`.

## 1. Servidor (requiere Node 22+, sin dependencias)
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
Copia `www/config.example.js` a `www/config.js`: `server` (URL https del servidor), `tema`, `nombre`, `assets` (logos base64). Los empleados se crean desde Ajustes > Equipo.

## 3. Compilar APK / escritorio
`npm install` → `npx cap add android && npx cap sync` (APK) · `npm run electron:build` (escritorio). O usa el workflow de GitHub Actions `.github/workflows/build.yml`. Android exige servidor HTTPS.

## Límites conocidos
- Sincronización por registro, última escritura gana: dos equipos vendiendo el mismo producto sin conexión pueden descuadrar stock.
- Los empleados ocultan costos en la interfaz, pero sus equipos reciben esos datos.
- Números de factura podrían repetirse si dos equipos facturan offline a la vez.
- La "factura" es un comprobante interno, no fiscal.
