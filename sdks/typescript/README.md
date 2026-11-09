# @angelpixel/identity-sdk (TypeScript)

SDK modular y tipado para Node.js y navegadores que facilita la interacción con el Identity Service de AngelPixel.

## Características

- **Modular:** Sub-recursos dedicados (`client.auth`, `client.users`, `client.oauth2`).
- **OAuth2 M2M Smart Caching:** Deduplicación automática de solicitudes y renovación proactiva antes de la expiración del token (buffer por defecto: 60s).
- **Dual Support:** Funciona de forma transparente tanto en entornos de Backend (Node.js con `fetch`) como Frontend (navegador).
- **Transporte desacoplado:** Admite inyección de adaptadores HTTP personalizados (`HttpTransport`) para pruebas o proxies corporativos.
- **Jerarquía de Errores Tipada:** Mapeo de errores RFC 6749 y HTTP a clases específicas (`AuthenticationError`, `OAuth2ProtocolError`, `ValidationError`, etc.).

## Instalación

```bash
npm install @angelpixel/identity-sdk
```

## Uso Rápido

### Autenticación M2M (Client Credentials Grant)

```typescript
import { IdentityServiceClient } from '@angelpixel/identity-sdk';

const client = new IdentityServiceClient({
  baseUrl: 'http://localhost:4000',
  refreshBufferSeconds: 60,
});

// Obtener token con Smart Cache en memoria
const token = await client.oauth2.getValidToken({
  clientId: 'm2m-service-app',
  clientSecret: 'MiSecretoSuperSeguro123!',
  scope: 'identity:read',
});

console.log('Access Token:', token.access_token);
```

### Registro de Usuario

```typescript
const registerResponse = await client.auth.register({
  tenantId: 'alpha-corp',
  email: 'admin@alpha.com',
  password: 'Password123!',
  name: 'Alpha Admin',
});
```

### Consulta de Perfil de Usuario

```typescript
const profile = await client.users.getProfile({
  token: token.access_token,
  tenantId: 'alpha-corp',
});

console.log('Perfil:', profile.email);
```

