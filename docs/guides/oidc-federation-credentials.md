# Guía de Configuración: Credenciales OIDC Externas (Google & Microsoft Entra ID)

Esta guía explica paso a paso cómo obtener credenciales OAuth 2.0 / OpenID Connect reales en **Google Cloud Console** y **Microsoft Entra ID (Azure Portal)** para operar la federación de identidad (`US-10` y `US-11`) en modo **Live** en lugar del emulador local de desarrollo.

---

## 1. Variables de Entorno Soportadas

El servicio lee las siguientes variables desde `.env` (o secretos de Kubernetes / Azure Key Vault):

| Variable | Proveedor | Obligatoriedad | Descripción |
| :--- | :--- | :--- | :--- |
| `GOOGLE_CLIENT_ID` | Google OIDC | Para modo Live | Client ID de aplicación Web en Google Cloud. |
| `GOOGLE_CLIENT_SECRET` | Google OIDC | Para modo Live | Client Secret asociado. |
| `MICROSOFT_CLIENT_ID` | Microsoft Entra ID | Para modo Live | Application (client) ID de Entra ID. |
| `MICROSOFT_CLIENT_SECRET` | Microsoft Entra ID | Para modo Live | Value del Client Secret (no el Secret ID). |
| `MICROSOFT_TENANT_ID` | Microsoft Entra ID | Opcional (`common`) | Tenant específico (UUID/dominio), `common`, `organizations` o `consumers`. |

> [!NOTE]
> Si estas variables no están definidas en `development`, el servidor emite una advertencia en consola al arrancar y opera con el emulador local (`devFederationHttpClient`). En `production` debes configurar credenciales reales.

---

## 2. Google Cloud Console (Google OIDC)

1. Ingresa a [Google Cloud Console](https://console.cloud.google.com/) y selecciona o crea un proyecto.
2. Ve a **APIs & Services → OAuth consent screen**:
   - Elige **External** (o **Internal** si es Google Workspace corporativo).
   - Completa el nombre de la aplicación (`Identity Service Portal`) y correos de contacto.
   - En **Scopes**, añade los scopes estándar OIDC: `openid`, `email`, `profile`.
   - Si la app está en estado *Testing*, agrega tu correo en **Test users**.
3. Ve a **APIs & Services → Credentials → + Create Credentials → OAuth client ID**:
   - **Application type:** `Web application`.
   - **Authorized JavaScript origins:**
     - Local: `http://localhost:3000` y `http://localhost:4000`
     - Producción: `https://<tu-dominio>`
   - **Authorized redirect URIs:**
     - Local (vía proxy Vite): `http://localhost:3000/api/v1/auth/federation/google/callback`
     - Local (API directa): `http://localhost:4000/api/v1/auth/federation/google/callback`
     - Producción: `https://<tu-dominio>/api/v1/auth/federation/google/callback`
4. Copia **Client ID** y **Client secret** a tu archivo `.env`:
   ```dotenv
   GOOGLE_CLIENT_ID=tu-google-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=tu-google-client-secret
   ```

---

## 3. Microsoft Entra ID (Azure Portal)

1. Ingresa al [Centro de administración de Microsoft Entra](https://entra.microsoft.com/) (o [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID**).
2. Ve a **Identity → Applications → App registrations → + New registration**:
   - **Name:** `identity-service`
   - **Supported account types:**
     - *Accounts in any organizational directory and personal Microsoft accounts* (para `MICROSOFT_TENANT_ID=common`), o
     - *Accounts in this organizational directory only* (para un `MICROSOFT_TENANT_ID` específico).
   - **Redirect URI (Web):**
     - Local (vía proxy Vite): `http://localhost:3000/api/v1/auth/federation/microsoft/callback`
     - Local (API directa): `http://localhost:4000/api/v1/auth/federation/microsoft/callback`
     - Producción: `https://<tu-dominio>/api/v1/auth/federation/microsoft/callback`
3. En la pantalla **Overview** de la app registrada, copia **Application (client) ID** (`MICROSOFT_CLIENT_ID`) y opcionalmente **Directory (tenant) ID** (`MICROSOFT_TENANT_ID`).
4. Ve a **Manage → Certificates & secrets → + New client secret**, crea un secreto y copia su **Value** (no el *Secret ID*) como `MICROSOFT_CLIENT_SECRET`.
5. Ve a **Manage → Token configuration / API permissions** y verifica que `openid`, `profile` y `email` estén habilitados (asegura que el claim `email` / `preferred_username` venga en el `id_token`).
6. Configura tu `.env`:
   ```dotenv
   MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
   MICROSOFT_CLIENT_SECRET=tu-microsoft-client-secret-value
   MICROSOFT_TENANT_ID=common
   ```

---

## 4. Verificación en Vivo (API & UI)

1. Reinicia el servidor backend (`npm run dev:api` o `npm run docker:dev`). En los logs de arranque desaparecerá el warning de modo emulador para los proveedores configurados.
2. Verifica el endpoint de estado:
   ```bash
   curl -s http://localhost:4000/api/v1/auth/federation/status | jq .
   ```
   Debes obtener `"configured": true` y `"mode": "live"` para el proveedor configurado.
3. Abre [`http://localhost:3000/auth`](http://localhost:3000/auth) → pestaña **`Federación`** y confirma que los chips cambian a **`Configurado (Live)`** en tono verde.
