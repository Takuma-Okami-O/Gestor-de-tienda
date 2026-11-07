# Notificaciones con la app cerrada (Firebase) — guía paso a paso

Sirve para que lleguen al teléfono, aunque la app esté cerrada:
- al dueño: "María envió un pedido";
- al vendedor: factura aprobada, pago registrado y recordatorios de pago del dueño.

Todo es gratis (Firebase Cloud Messaging + Supabase). Haz los pasos en este orden:

## 1. Firebase (Google)
1. Entra a https://console.firebase.google.com → **Agregar proyecto** (nombre libre, desactiva Analytics).
2. En el proyecto: **Agregar app → Android**. Nombre del paquete: `com.bizcontrol.app` (exacto). Apodo libre. Registrar.
3. Descarga **google-services.json** y ábrelo con el Bloc de notas: copia TODO su contenido.
4. En GitHub (tu repositorio): **Settings → Secrets and variables → Actions → New repository secret**.
   Nombre: `GOOGLE_SERVICES_JSON` — Valor: el contenido completo del archivo. Guardar.
5. En Firebase: ⚙️ **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**. Se descarga un archivo .json: guárdalo, lo usarás en el paso 3. (No lo subas a GitHub.)

## 2. Supabase — base de datos
- **SQL Editor**: pega y ejecuta de nuevo todo `supabase/schema.sql` (agrega las tablas y avisos push).

## 3. Supabase — función que envía los avisos
1. **Edge Functions → Deploy a new function → Via Editor**. Nombre: `push`. Borra el ejemplo y pega todo el contenido de `supabase/functions/push/index.ts`. Deploy.
2. **Edge Functions → Secrets → Add new secret**: nombre `FCM_SERVICE_ACCOUNT`, valor = el contenido COMPLETO del .json del paso 1.5.

## 4. Supabase — conectar la tabla con la función
**Database → Webhooks → Create a new hook**
- Name: `push_outbox`
- Table: `push_outbox` — Events: **Insert**
- Type: **Supabase Edge Functions** → Function: `push` → Method: POST
- Create webhook.

## 5. Nuevo APK
Sube los archivos del proyecto (incluye `.github/workflows/build.yml` y `package.json`) → espera que Actions termine en verde → instala el APK nuevo.
Cada persona (dueño y vendedores) debe abrir la app una vez con su sesión y **aceptar el permiso de notificaciones**.

## Prueba
Dueño → Vendedores → un vendedor con saldo → **🔔 Enviar recordatorio a su app**. Cierra la app del vendedor: debe sonar el teléfono en unos segundos.

## Si no llega
- Revisa que el secreto `GOOGLE_SERVICES_JSON` esté bien (el paso "Firebase" de Actions debe decir "google-services.json instalado").
- Supabase → Edge Functions → push → **Logs**: ahí aparece el error exacto de Firebase.
- Ajustes del teléfono → Apps → Gestor de Tienda → Notificaciones: permitidas y sin "ahorro de batería" restringido.
