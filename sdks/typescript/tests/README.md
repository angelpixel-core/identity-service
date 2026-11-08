# TypeScript SDK Tests

Suites de pruebas automatizadas del SDK:
- `auth.test.ts`: Pruebas de `TokenManager` (smart in-memory cache, preemptive auto-renewal, invalidación y cache bypass).
- `client.test.ts`: Pruebas de integración de `IdentityServiceClient` y sus recursos (`auth.register`, `users.getProfile`, `oauth2.validateOrigin`, `oauth2.getValidToken`).
- `errors.test.ts`: Pruebas de jerarquía de excepciones y serialización compatible RFC 6749.

