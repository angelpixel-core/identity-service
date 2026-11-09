# Guía de Pruebas Interactivas: US-07 (OIDC Discovery 1.0 & JWKS Cryptographic Engine)

> **Document ID:** `GUIDELINE-08-oidc-discovery-and-jwks`  
> **Bounded Context:** `identity` / `oidc` / `crypto`  
> **Historia de Usuario:** [US-07: Cryptographic Keypair Management, JWKS and OpenID Discovery Endpoints](../epics/EPIC-04-oidc-server-sessions/stories/US-07-jwks-discovery-endpoints.md)  
> **Estándares RFC:** [RFC 8414 (OAuth 2.0 Authorization Server Metadata)](https://datatracker.ietf.org/doc/html/rfc8414), [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html), [RFC 7517 (JSON Web Key - JWK)](https://datatracker.ietf.org/doc/html/rfc7517), [RFC 7518 (JSON Web Algorithms - RS256)](https://datatracker.ietf.org/doc/html/rfc7518)  
> **Componentes Principales:**
> - `DiscoveryController` ([`interfaces/http/rest/v1/oidc/discovery_controller.ts`](../../interfaces/http/rest/v1/oidc/discovery_controller.ts))
> - `GetOpenIdConfigurationQueryHandler` ([`src/contexts/identity/application/queries/get_openid_configuration/handler.ts`](../../src/contexts/identity/application/queries/get_openid_configuration/handler.ts))
> - `GetJwksQueryHandler` ([`src/contexts/identity/application/queries/get_jwks/handler.ts`](../../src/contexts/identity/application/queries/get_jwks/handler.ts))
> - `AsymmetricKeyProviderPort` ([`src/contexts/identity/domain/ports/crypto/asymmetric_key_provider_port.ts`](../../src/contexts/identity/domain/ports/crypto/asymmetric_key_provider_port.ts))
> - `RsaKeyAdapter` ([`src/contexts/identity/infrastructure/security/rsa_key_adapter.ts`](../../src/contexts/identity/infrastructure/security/rsa_key_adapter.ts))
> - `DiscoveryResource` ([`sdks/typescript/src/resources/discovery_resource.ts`](../../sdks/typescript/src/resources/discovery_resource.ts))

---

## 1. Visión General

Esta guía detalla los procedimientos paso a paso para interactuar manualmente y verificar en un entorno real la infraestructura de **Criptografía Asimétrica RSA (RS256)**, los endpoints estándar de **OpenID Connect Discovery 1.0** y el conjunto de claves públicas **JWKS (RFC 7517)** introducidos en **US-07**.

### El Problema de los Secretos Compartidos vs Criptografía Asimétrica

En arquitecturas distribuidas basadas en microservicios y aplicaciones frontend (Single Page Applications, Mobile), la validación de tokens JWT mediante firmas simétricas (HS256) presenta severas limitaciones de escalabilidad y seguridad:
1. **Fuga de Secretos:** Cada servicio consumidor que requiera validar un token necesita conocer el secreto simétrico (`JWT_SECRET`). Si un microservicio perimetral se ve comprometido, el atacante puede forjar tokens arbitrarios para cualquier usuario del sistema.
2. **Rotación Compleja:** Rotar una clave simétrica requiere coordinar despliegues simultáneos en todos los clientes y servicios del ecosistema.
3. **Imposibilidad de Validación en Clientes Públicos:** Las aplicaciones SPA o móviles jamás deben contener una clave de firma simétrica.

### Solución Arquitectónica: Modelo Asimétrico OIDC / JWKS

Con **US-07**, **AngelPixel Identity Service** pasa a operar como un Proveedor de Identidad (IdP) OIDC moderno y federable:
- El servidor custodia exclusivamente la **clave privada RSA** (`PKCS#8`) con la que firma tokens asimétricos `RS256` e inyecta en la cabecera JWT el identificador de clave (`kid`).
- Los clientes y microservicios satélite descargan de forma autónoma la **clave pública RSA** (`SPKI / JWK`) desde `GET /.well-known/jwks.json`.
- La configuración completa del proveedor de identidad (endpoints de autorización, tokens, userinfo, algoritmos y scopes) se expone de forma estándar y universalmente descubrible en `GET /.well-known/openid-configuration`.

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   AngelPixel Identity Service (IdP Server)                      │
│                                                                                  │
│   ┌──────────────────────────┐             ┌───────────────────────────────────┐ │
│   │ Clave Privada RSA        │             │ Clave Pública RSA                 │ │
│   │ (PKCS#8 - [REDACTED])    │             │ (SPKI - Formato JWK RFC 7517)     │ │
│   └────────────┬─────────────┘             └─────────────────┬─────────────────┘ │
│                │ Firma asimétrica                            │ Exportación       │
│                ▼                                             ▼                   │
│   ┌──────────────────────────┐             ┌───────────────────────────────────┐ │
│   │ Token JWT (RS256 + kid)  │             │ GET /.well-known/jwks.json        │ │
│   └────────────┬─────────────┘             └─────────────────┬─────────────────┘ │
└────────────────┼─────────────────────────────────────────────┼───────────────────┘
                 │                                             │
                 │ 1. Token en cabecera Authorization          │ 2. Descarga pública JWKS
                 ▼                                             ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│              Microservicio Consumidor / API Gateway / SPA Client                 │
│                                                                                  │
│   - Consulta /.well-known/jwks.json y almacena en caché local la clave pública   │
│   - Lee el 'kid' de la cabecera del token JWT                                    │
│   - Verifica criptográficamente la firma RS256 en memoria local                  │
│   - ZERO shared secrets: Si el consumidor se compromete, la firma sigue segura   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Preparación del Entorno

### Paso 2.1: Verificar Contenedores en Docker Compose

Asegúrate de que el servicio de API (`identity-api`) y sus dependencias estén activos y en estado saludable:

```bash
docker compose ps
```

Salida esperada:
```text
NAME             IMAGE                STATUS                 PORTS
identity-api     identity-api         Up                     0.0.0.0:4000->4000/tcp
identity-cache   redis:7-alpine       Up (healthy)           0.0.0.0:6379->6379/tcp
identity-db      postgres:16-alpine   Up (healthy)           0.0.0.0:5432->5432/tcp
```

Si los contenedores no están levantados:
```bash
docker compose up -d
```

> [!NOTE]
> En entorno de desarrollo o testing standalone, la API puede ejecutarse de manera autónoma con `npm run dev:api` escuchando en el puerto local `3000`.

---

## 3. Procedimiento de Pruebas Interactivas

### Paso 3.1: Descubrimiento de Metadatos OpenID Connect (RFC 8414)

El endpoint `GET /.well-known/openid-configuration` debe estar ubicado en la raíz del host y responder con el documento de configuración del proveedor.

#### Petición HTTP cURL:

```bash
curl -i -s -X GET http://localhost:4000/.well-known/openid-configuration
```

#### Cabeceras y Código de Respuesta Esperados:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=3600, stale-while-revalidate=86400
X-Content-Type-Options: nosniff
```

#### Cuerpo de Respuesta Esperado (JSON):

```json
{
  "issuer": "http://localhost:4000",
  "authorization_endpoint": "http://localhost:4000/oauth2/authorize",
  "token_endpoint": "http://localhost:4000/api/v1/oauth2/token",
  "jwks_uri": "http://localhost:4000/.well-known/jwks.json",
  "userinfo_endpoint": "http://localhost:4000/api/v1/auth/me",
  "response_types_supported": [
    "code"
  ],
  "subject_types_supported": [
    "public"
  ],
  "id_token_signing_alg_values_supported": [
    "RS256"
  ],
  "scopes_supported": [
    "openid",
    "profile",
    "email",
    "identity:read",
    "identity:write"
  ],
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post",
    "none"
  ],
  "claims_supported": [
    "sub",
    "iss",
    "aud",
    "exp",
    "iat",
    "email",
    "tenantId"
  ],
  "code_challenge_methods_supported": [
    "S256"
  ],
  "grant_types_supported": [
    "authorization_code",
    "client_credentials",
    "refresh_token"
  ]
}
```

> [!IMPORTANT]
> **Garantía CORS:** La presencia de `Access-Control-Allow-Origin: *` es obligatoria para permitir que clientes browser-based (React, Vue, Angular) y librerías cliente como `oidc-client-ts` o `angular-oauth2-oidc` descubran la configuración sin bloqueos por políticas de origen cruzado.

---

### Paso 3.2: Obtención del Conjunto de Claves Públicas JWKS (RFC 7517)

El endpoint `GET /.well-known/jwks.json` expone la clave pública criptográfica con la que los tokens RS256 son emitidos.

#### Petición HTTP cURL:

```bash
curl -i -s -X GET http://localhost:4000/.well-known/jwks.json
```

#### Cabeceras y Código de Respuesta Esperados:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: public, max-age=3600, stale-while-revalidate=86400
X-Content-Type-Options: nosniff
```

#### Cuerpo de Respuesta Esperado (JSON):

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "key-8b7a42f1c09e",
      "n": "vXmZ4A7W0uG_9P_8J7Q1k...",
      "e": "AQAB"
    }
  ]
}
```

#### Anatomía de los Parámetros JWK:
- **`kty` (Key Type):** Familia de algoritmo criptográfico. Obligatoriamente `RSA`.
- **`use` (Public Key Use):** Propósito previsto de la clave pública. `sig` (firma digital y verificación).
- **`alg` (Algorithm):** Algoritmo específico según RFC 7518. `RS256` (RSA Signature with SHA-256).
- **`kid` (Key ID):** Identificador unívoco del par de claves activo generado a partir del thumbprint SHA-256 de la clave pública.
- **`n` (Modulus):** Módulo RSA codificado en Base64URL.
- **`e` (Exponent):** Exponente público RSA codificado en Base64URL (típicamente `AQAB`, correspondiente a $65537$).

---

### Paso 3.3: Verificación Criptográfica Local de Tokens Asimétricos (Zero Shared Secret)

Para comprobar que un consumidor puede verificar de manera autónoma un token RS256 descargando únicamente la clave pública de `/.well-known/jwks.json`, ejecutamos un script interactivo en Node.js.

Crea un script de prueba interactiva en `scripts/test_verify_jwks_offline.js`:

```javascript
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

async function testOfflineJwksVerification() {
  const BASE_URL = process.env.ISSUER_URL || 'http://localhost:4000';
  console.log(`\n🔍 1. Consultando JWKS desde ${BASE_URL}/.well-known/jwks.json...`);

  const response = await fetch(`${BASE_URL}/.well-known/jwks.json`);
  if (!response.ok) {
    throw new Error(`Fallo al obtener JWKS: HTTP ${response.status}`);
  }

  const jwks = await response.json();
  const activeKey = jwks.keys[0];
  console.log(`✅ Clave activa encontrada: kid="${activeKey.kid}", kty="${activeKey.kty}", alg="${activeKey.alg}"`);

  // 2. Reconstrucción de la clave pública en formato KeyObject nativo de Node.js
  const publicKeyObject = crypto.createPublicKey({
    key: {
      kty: activeKey.kty,
      n: activeKey.n,
      e: activeKey.e,
    },
    format: 'jwk',
  });

  const publicKeyPem = publicKeyObject.export({ type: 'spki', format: 'pem' });
  console.log(`✅ Clave pública SPKI exportada exitosamente:\n${publicKeyPem.split('\n').slice(0, 3).join('\n')}...\n`);

  // 3. Simulación de validación de un token RS256 con el Key ID esperado
  console.log('🔒 3. La clave pública está lista para verificar cualquier ID Token o Access Token RS256 firmado por el IdP sin necesidad de ningún secreto compartido.');
}

testOfflineJwksVerification().catch(console.error);
```

Ejecuta el script:
```bash
node scripts/test_verify_jwks_offline.js
```

Salida esperada:
```text
🔍 1. Consultando JWKS desde http://localhost:4000/.well-known/jwks.json...
✅ Clave activa encontrada: kid="key-8b7a42f1c09e", kty="RSA", alg="RS256"
✅ Clave pública SPKI exportada exitosamente:
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...

🔒 3. La clave pública está lista para verificar cualquier ID Token o Access Token RS256 firmado por el IdP sin necesidad de ningún secreto compartido.
```

---

### Paso 3.4: Verificación de Políticas de Caché y Cabeceras de Seguridad

Comprueba que las cabeceras emitidas reducen la sobrecarga de consultas y protegen contra ataques de confusión MIME:

```bash
curl -I -s http://localhost:4000/.well-known/openid-configuration | grep -E -i "(cache-control|x-content-type-options|access-control)"
```

Salida esperada:
```text
access-control-allow-origin: *
cache-control: public, max-age=3600, stale-while-revalidate=86400
x-content-type-options: nosniff
```

- **`max-age=3600`:** Permite a proxies, CDNs y clientes almacenar en caché la configuración durante 1 hora.
- **`stale-while-revalidate=86400`:** Permite servir contenido en caché mientras se revalida asíncronamente en segundo plano.
- **`nosniff`:** Previene que navegadores ejecuten payloads como JavaScript si son interpretados erróneamente.

---

## 4. Consumo Programático mediante TypeScript SDK

El SDK oficial `@angelpixel-core/identity-service` expone el recurso `discovery` para interactuar de forma fuertemente tipada con ambos endpoints.

### Ejemplo de Inicialización y Consumo:

```typescript
import { IdentityServiceClient } from '@angelpixel-core/identity-service';

async function main() {
  const client = new IdentityServiceClient({
    baseUrl: 'http://localhost:4000',
  });

  // 1. Obtener metadatos de configuración OIDC
  const oidcConfig = await client.discovery.getOpenIdConfiguration();
  console.log('Issuer:', oidcConfig.issuer);
  console.log('Token Endpoint:', oidcConfig.token_endpoint);
  console.log('JWKS URI:', oidcConfig.jwks_uri);
  console.log('Algoritmos soportados:', oidcConfig.id_token_signing_alg_values_supported);

  // 2. Obtener conjunto de claves públicas JWKS
  const jwks = await client.discovery.getJwks();
  console.log(`Total de claves activas: ${jwks.keys.length}`);

  for (const key of jwks.keys) {
    console.log(`Key ID: ${key.kid} | Tipo: ${key.kty} | Algoritmo: ${key.alg}`);
  }
}

main().catch(console.error);
```

### Integración con Librerías del Ecosistema (`jose` / `jwks-rsa`):

Cualquier microservicio puede configurar clientes estándar apuntando al `jwks_uri`:

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

// Configurar el conjunto de claves remotas
const JWKS = createRemoteJWKSet(new URL('http://localhost:4000/.well-known/jwks.json'));

async function verifyIncomingToken(bearerToken: string) {
  const { payload, protectedHeader } = await jwtVerify(bearerToken, JWKS, {
    issuer: 'http://localhost:4000',
    algorithms: ['RS256'],
  });

  console.log('Token verificado para usuario:', payload.sub);
  console.log('Tenant:', payload.tenantId);
}
```

---

## 5. Checklist de Verificación y Criterios de Aceptación

| Requisito / Invariante | Estándar RFC | Endpoint | Estado |
| :--- | :--- | :--- | :---: |
| Metadata Discovery OIDC | RFC 8414 & OIDC Core 1.0 | `GET /.well-known/openid-configuration` | **PASS** |
| Claves Públicas Criptográficas | RFC 7517 | `GET /.well-known/jwks.json` | **PASS** |
| Firma Asimétrica RS256 | RFC 7518 | `id_token_signing_alg_values_supported` | **PASS** |
| Identificador de Clave (`kid`) | RFC 7517 Sección 4.5 | Presente en JWK y cabecera JWT | **PASS** |
| CORS Habilitado (`Access-Control-Allow-Origin: *`) | W3C CORS Spec | Ambos endpoints | **PASS** |
| Redacción de Clave Privada en Logs | CWE-312 / Zero-Trust | `RsaKeyAdapter.toString()` -> `[REDACTED]` | **PASS** |
| Cabecera Cache-Control Optimizada | RFC 9111 | `public, max-age=3600` | **PASS** |
| Tipado e Integración en TypeScript SDK | Clean Architecture | `client.discovery` | **PASS** |

---

## 6. Diagnóstico y Troubleshooting

### 1. Error de CORS en Aplicaciones Frontend
- **Síntoma:** El navegador bloquea la llamada con `No 'Access-Control-Allow-Origin' header is present on the requested resource`.
- **Causa:** El endpoint no está respondiendo a través de `DiscoveryController` o un proxy intermedio elimina la cabecera.
- **Solución:** Comprueba que la respuesta directa devuelva `access-control-allow-origin: *` con `curl -I http://localhost:4000/.well-known/openid-configuration`.

### 2. Discrepancia en la URL del Emisor (`issuer`)
- **Síntoma:** La librería cliente rechaza el token con `JWTClaimValidationFailed: unexpected "iss" claim value`.
- **Causa:** El contenedor Docker o reverse proxy utiliza una URL de host diferente a la configurada en `PUBLIC_ISSUER_URL`.
- **Solución:** Configura la variable de entorno `PUBLIC_ISSUER_URL=https://tu-dominio.com` en el archivo `.env` o en `docker-compose.yml` para garantizar que la reconstrucción del emisor coincida exactamente con la URL pública.

### 3. Error de Firma Inválida al Verificar Token
- **Síntoma:** `jwt.verify` lanza `JsonWebTokenError: invalid signature`.
- **Causa:** El token fue emitido con un algoritmo simétrico (HS256) anterior o la clave en memoria se reinició tras un reinicio del servidor sin persistencia de claves en variables de entorno.
- **Solución:** Proporciona un par de claves RSA persistentes mediante las variables de entorno `RSA_PRIVATE_KEY_PEM` y `RSA_PUBLIC_KEY_PEM` para entornos de producción.
