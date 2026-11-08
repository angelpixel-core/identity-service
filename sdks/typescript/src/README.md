# TypeScript SDK Source Code

Estructura modular del SDK:
- `index.ts`: Punto de entrada unificado y re-exportaciones públicas.
- `client.ts`: Clase principal `IdentityServiceClient` y alias `OAuth2M2MClient`.
- `auth.ts`: `TokenManager` con Smart In-Memory Caching y auto-renovación.
- `config.ts`: Configuración por defecto y transporte HTTP nativo.
- `errors.ts`: Jerarquía de errores tipados.
- `resources/`: Recursos desacoplados (`auth`, `users`, `oauth2`).
- `types/`: Tipos e interfaces de datos.

