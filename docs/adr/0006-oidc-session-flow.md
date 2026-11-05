# 6. Servidor de Autorización OpenID Connect (OIDC), Criptografía Asimétrica y Ciclo de Sesiones

* **Status:** Accepted
* **Date:** 2026-11-05
* **Deciders:** Principal Identity & Security Architect, Equipo de Ingeniería

## Contexto y Problema

Para que `identity-service` opere como el Identity Provider (IdP) central del ecosistema, los servicios y aplicaciones consumidoras (tiendas, portales de IA, backends satélites) necesitan autenticar usuarios y validar permisos de manera autónoma.

En arquitecturas iniciales, es común recurrir a firmas simétricas (HS256 con una clave secreta compartida). Sin embargo, en un ecosistema distribuido:
1. Compartir una clave simétrica con múltiples microservicios satélites introduce un riesgo crítico: el compromiso de un único servicio permitiría a un atacante forjar tokens legítimos para cualquier otra aplicación del sistema.
2. Almacenar tokens de actualización (*Refresh Tokens*) en el almacenamiento local del navegador (`localStorage` / `sessionStorage`) deja a los usuarios vulnerables a robo de sesión masivo mediante ataques Cross-Site Scripting (XSS).
3. Los clientes externos carecen de una vía estandarizada para consultar los endpoints del proveedor, requerimientos de scopes y claves públicas para verificar firmas.

## Drivers de la Decisión

- Desacoplamiento criptográfico total: Los microservicios consumidores deben poder verificar firmas de tokens sin poseer la clave privada de emisión.
- Cumplimiento de los estándares de la industria: OpenID Connect Core 1.0, RFC 6749 (OAuth 2.0), RFC 7636 (PKCE) y RFC 8414 (OAuth 2.0 Authorization Server Metadata).
- Máxima protección de sesiones en el navegador contra ataques XSS y CSRF.
- Detección y mitigación automática ante robo o reuso de tokens de actualización.

## Opciones Consideradas

1. **Firma Simétrica HS256 con distribución de secretos compartidos:** Insegura para arquitecturas distribuidas con múltiples consumidores.
2. **Tokens en LocalStorage con endpoints propietarios:** Vulnerable a XSS y acoplamiento con librerías cliente no estándar.
3. **Criptografía Asimétrica RS256 con JWKS Dinámico, OIDC Discovery y Refresh Tokens en Cookies HttpOnly con Rotación Estricta:** Estándar enterprise que permite verificación pública descentralizada y protege las credenciales en el cliente web.

## Decisión

Adoptar una arquitectura de **Servidor de Autorización OIDC con Criptografía Asimétrica RS256, Discovery y Sesiones con Refresh Token Rotation**:

1. **Esquema Criptográfico Asimétrico:**
   * Emisión de tokens firmados mediante **RS256 (RSA 2048-bit)**.
   * La clave privada reside estrictamente resguardada en `identity-service` (variables de entorno seguras o KMS).
   * Cada token emitido incluye en su cabecera el identificador único de clave `kid` (*Key ID*).
   * La clave pública correspondiente se expone en formato estándar JSON Web Key Set en el endpoint:
     `GET /.well-known/jwks.json`

2. **Endpoints de Descubrimiento Estándar (Discovery):**
   * Exposición de metadatos en:
     `GET /.well-known/openid-configuration`
     Informando `issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `response_types_supported`, `id_token_signing_alg_values_supported` (`RS256`), `scopes_supported` y `code_challenge_methods_supported` (`S256`).

3. **Flujos de Autorización:**
   * **Authorization Code Flow con PKCE (RFC 7636):** Mandatorio para clientes públicos (SPAs / Web / Mobile). El cliente envía `code_challenge` (S256) en el paso de autorización y el `code_verifier` en el intercambio por tokens.
   * **Client Credentials Flow (RFC 6749):** Para comunicación M2M entre servicios backend utilizando `client_id` y `client_secret`.

4. **Ciclo de Vida de Tokens y Sesiones Web:**
   * **Access Token:** JWT de corta duración (15 minutos) con claims `sub`, `tenant_id`, `client_id`, `scopes`, `email`.
   * **ID Token:** JWT OIDC con información de perfil de identidad.
   * **Refresh Token:** Token opaco de alta entropía (256 bits), almacenado con hash criptográfico en PostgreSQL.
   * **Transporte Seguro:** Los Refresh Tokens se transmiten exclusivamente mediante cookies con atributos:
     * `HttpOnly` (inaccesible desde JavaScript / Document Object Model, mitigando XSS).
     * `Secure` (transmitido únicamente por HTTPS/TLS).
     * `SameSite=Strict` (protección total contra CSRF).
     * `Path=/api/v1/oauth2` (restringido a endpoints de sesión).
   * **Rotación y Detección de Reuso (Token Family):** Cada llamada a refresh invalida el token consumido y entrega un nuevo par. Si un token previamente invalidado es presentado (evidencia de compromiso o intercepción), el sistema revoca inmediatamente toda la familia de tokens (`family_id`), cerrando la sesión en todos los dispositivos.

## Consecuencias

### Positivas
- Cualquier servicio del ecosistema o gateway puede validar tokens localmente descargando el JWKS una sola vez y cacheándolo.
- Protección total contra vectores de fuga XSS para tokens de larga duración.
- Detección proactiva de intrusiones mediante el seguimiento de familias de refresh tokens.
- Compatibilidad directa con cualquier librería cliente estándar (OIDC Client, NextAuth, React OIDC, etc.).

### Negativas / Riesgos
- Mayor costo computacional en la firma asimétrica RS256 respecto a HS256 (despreciable en entornos Node.js modernos con libuv/OpenSSL).
- Requiere orquestar un proceso seguro para la rotación periódica de claves asimétricas en producción.

