# Guía de Pruebas Visuales en Navegador: Web App & Storybook Design System

> **Document ID:** `GUIDELINE-03-visual-browser-testing`  
> **Bounded Context:** `identity`  
> **Historias de Usuario Cubiertas:** `US-01` (User Registration) y `US-02` (Tenant Profile Read & Cache)  
> **Arquitectura:** Component-Driven Development (Storybook + React 19) + Web App Shell (Vite) + Multi-Tenant Isolation (ADR-0003)

---

## 1. Visión General

A diferencia de las guías de CLI y APIs REST ([GUIDELINE-01](GUIDELINE-01-interactive-testing-us-01.md) y [GUIDELINE-02](GUIDELINE-02-interactive-testing-us-02.md)), esta guía está diseñada **exclusivamente para pruebas interactivas visuales en el navegador web**.

Permite validar la experiencia de usuario en dos entornos complementarios:
1. **Design System / Workbench Aislado (Storybook en `http://localhost:6006`):**
   * Inspección y prueba de componentes en aislamiento (`RegisterForm` y `UserProfileCard`).
   * Validación visual de todos los estados límite: validación de campos, estados de carga lenta (*skeletons/spinners*), errores de conflicto de tenant (HTTP 409) y botones de reintento.
2. **Web App Portal Integrado (Vite en `http://localhost:3000`):**
   * Flujo completo de usuario en vivo conectado a la infraestructura real de Docker (PostgreSQL, Redis y API Express).
   * Transición interactiva desde el formulario de registro hasta la tarjeta de perfil con inspección de tiempos de respuesta de caché en las herramientas de desarrollo (*DevTools*).

---

## 2. Preparación y Puesta en Marcha del Entorno

### Opción A: Con Docker Compose (Recomendado)

Levanta la infraestructura completa incluyendo los servicios de frontend y catálogo visual:

```bash
docker compose --profile ui up -d
```

Verifica el estado de los 5 contenedores:
```bash
docker compose ps
```

| Contenedor | Servicio | Puerto Expuesto | Función |
| :--- | :--- | :--- | :--- |
| `identity-web` | `web` | `http://localhost:3000` | Portal Web interactivo (Vite SPA) |
| `identity-design-system` | `design-system` | `http://localhost:6006` | Catálogo de componentes (Storybook) |
| `identity-api` | `api` | `http://localhost:4000` | Backend REST Express |
| `identity-db` | `db` | `localhost:5432` | Base de datos PostgreSQL 16 |
| `identity-cache` | `cache` | `localhost:6379` | Capa de caché Redis 7 |

### Opción B: Ejecución Local en Host (Sin Docker)

Si prefieres ejecutar los servidores en local:
```bash
# Terminal 1: API Backend
npm run dev:api

# Terminal 2: Web App
npm run dev:web

# Terminal 3: Storybook Design System
npm run storybook
```

---

## 3. Parte 1: Pruebas Visuales en Storybook (`http://localhost:6006`)

Abre tu navegador y navega a `http://localhost:6006`. En la barra lateral izquierda verás la categoría **`Identity`** con los dos componentes del sistema.

### 3.1. Pruebas del Formulario de Registro (`Identity/RegisterForm`)

Selecciona en el menú lateral `Identity` -> `RegisterForm`:

#### Escenario 1.1: Estado Default (`Default`)
* **Qué observar:**
  * Formulario centrado con tres campos: *Tenant ID* (pre-llenado con `acme-corp`), *Email* y *Password*.
  * Botón primario azul `Create Account`.
* **Prueba interactiva de validación defensiva:**
  1. En el campo *Password*, escribe `123` (menos de 8 caracteres).
  2. Haz clic en `Create Account`.
  3. **Verificación visual:** Aparece inmediatamente una caja de alerta roja con el mensaje accesible:  
     `"Password must be at least 8 characters long"`.
* **Prueba interactiva de éxito:**
  1. Escribe en *Email*: `test@acme.com`.
  2. Escribe en *Password*: `Password123!`.
  3. Haz clic en `Create Account`.
  4. **Verificación visual:** Se dispara el callback de éxito mostrando el alert de confirmación de registro.

#### Escenario 1.2: Error de Conflicto Multi-Tenant (`ConflictError`)
* **Qué observar:**
  * Al intentar enviar el formulario, el componente simula un rechazo HTTP 409 del servidor.
  * **Verificación visual:** Aparece la caja de alerta roja:  
    `"User with email ... already exists in tenant acme-corp"`.

#### Escenario 1.3: Estado de Carga / Red Lenta (`SlowNetworkLoading`)
* **Qué observar:**
  1. Haz clic en `Create Account`.
  2. **Verificación visual:** Durante 3 segundos, el botón cambia de texto a `"Creating account..."`, se atenúa su opacidad y queda deshabilitado (`disabled`), impidiendo clics duplicados del usuario.

---

### 3.2. Pruebas de la Tarjeta de Perfil (`Identity/UserProfileCard`)

Selecciona en el menú lateral `Identity` -> `UserProfileCard`:

#### Escenario 2.1: Perfil Exitoso (`DefaultSuccess`)
* **Qué observar:**
  * Tarjeta estilizada con tipografía limpia y sombra suave.
  * Encabezado con título **"User Profile"** y un badge morado/azul distintivo con el texto:  
    `TENANT: ACME-CORP`.
  * Lista de definición con pares clave-valor alineados:
    * **User ID:** `usr_89234b9a-4c21...`
    * **Email:** `carlos@acme.com`
    * **Member Since:** Fecha formateada localmente.
  * Botón inferior `Reload` con estilos primarios.

#### Escenario 2.2: Organización Secundaria (`CustomTenantBeta`)
* **Qué observar:**
  * **Verificación visual:** El badge cambia inmediatamente para reflejar la organización `TENANT: BETA-CORP` y el usuario asociado `valeria@beta-corp.com`, confirmando la capacidad del componente de adaptarse al tenant activo.

#### Escenario 2.3: Estado de Carga Continua (`LoadingState`)
* **Qué observar:**
  * El componente renderiza un estado visual accesible `role="status"` con el texto animado:  
    `"Loading profile..."`.

#### Escenario 2.4: Manejo de Error con Reintento (`ErrorWithRetry`)
* **Qué observar:**
  * La tarjeta renderiza un contenedor de alerta `role="alert"`:
    * Mensaje descriptivo: `"401 Unauthorized: Session token has expired or is invalid"`.
    * Botón interactivo secundario **`Retry`**.
  * Al pulsar `Retry`, el componente vuelve a activar el ciclo de carga intentando recuperar los datos.

---

## 4. Parte 2: Pruebas Visuales en la Web App (`http://localhost:3000`)

Abre una pestaña en tu navegador y accede a `http://localhost:3000`.

### 4.1. Flujo Completo: Registro y Transición a Perfil

#### Paso 1: Pantalla de Bienvenida y Formulario de Registro
* La aplicación carga el portal **"Identity Service Portal"** centrado en pantalla.
* En el formulario:
  * **Tenant ID:** Deja el valor predeterminado `acme-corp` (o cámbialo si deseas).
  * **Email:** Ingresa `usuario.visual@acme.com`.
  * **Password:** Ingresa `PasswordSegura2026!`.
* Haz clic en **"Create Account"**.

#### Paso 2: Transición Reactiva Inmediata
* Al recibir el token JWT y los datos del servidor (HTTP 201 Created):
  1. El formulario de registro desaparece automáticamente.
  2. Aparece la barra superior de sesión:  
     `Conectado como: usuario.visual@acme.com (acme-corp)` junto con el botón **"Cerrar Sesión"**.
  3. Se renderiza la tarjeta **`UserProfileCard`** consumiendo en vivo el endpoint `GET /api/v1/auth/me`.
  4. Verifica en pantalla:
     * El badge `TENANT: ACME-CORP`.
     * El identificador UUID generado por PostgreSQL.
     * La fecha de registro actual.

---

### 4.2. Inspección de Caché en las Herramientas de Desarrollo (DevTools)

Esta prueba permite constatar visualmente la diferencia de rendimiento entre *Cache Miss* y *Cache Hit*:

1. Abre las herramientas de desarrollo de tu navegador (`F12` o `Cmd + Option + I`).
2. Ve a la pestaña **Network** (Red) y filtra por `Fetch/XHR`.
3. En la tarjeta de perfil en pantalla, haz clic en el botón **"Reload"**.
4. Inspecciona la fila correspondiente a `GET /api/v1/auth/me`:
   * **Status:** `200 OK`.
   * **Tiempo de respuesta:** Típicamente inferior a **5 ms** (servido instantáneamente desde la memoria RAM del backend mediante `MemoryCacheAdapter`).
   * **Respuesta JSON:** Sanitizada, conteniendo únicamente `{ id, email, tenantId, createdAt, updatedAt }` sin campos de contraseña.

---

### 4.3. Validación Visual de Aislamiento Multi-Tenant

Para comprobar que dos inquilinos distintos conviven en la misma plataforma sin colisiones de usuario:

1. En la barra superior de la Web App, haz clic en **"Cerrar Sesión"**.
   * La interfaz limpia el estado de sesión y vuelve a mostrar el formulario de registro.
2. Configura los siguientes campos:
   * **Tenant ID:** Escribe `beta-corp`.
   * **Email:** Ingresa el **mismo correo** utilizado anteriormente: `usuario.visual@acme.com`.
   * **Password:** Ingresa `PasswordSegura2026!`.
3. Haz clic en **"Create Account"**.
4. **Verificación visual del aislamiento:**
   * El registro es aceptado con éxito (HTTP 201).
   * La barra de sesión muestra `Conectado como: usuario.visual@acme.com (beta-corp)`.
   * La tarjeta de perfil muestra el badge `TENANT: BETA-CORP`.
   * Esto demuestra visualmente que el sistema permite el registro del mismo email bajo organizaciones diferentes conforme a la directriz arquitectónica [ADR-0003](../../docs/adr/0003-multi-tenant-isolation-strategy.md).

---

## 5. Resumen de Puntos de Verificación Visual

| Elemento Visual | Estado Esperado | Criterio de Aceptación |
| :--- | :--- | :--- |
| **Input Password (< 8 chars)** | Alerta roja en vivo | Cumple invariante de longitud mínima |
| **Botón de Envío en Carga** | Deshabilitado con texto *"Creating account..."* | Previene doble sumisión en red lenta |
| **Badge de Tenant** | Píldora de color con slug en mayúsculas | Claridad contextual de la organización |
| **Tarjeta de Perfil** | Datos estructurados sin password hash | Proyección sanitizada `UserProfileDTO` |
| **Botón Reload** | Refresco inmediato de datos | Comprobación de Cache Hit en DevTools |
| **Cierre de Sesión** | Retorno al formulario con limpieza de estado | Aislamiento y control de ciclo de vida |

