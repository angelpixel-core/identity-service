# AngelPixel Identity Service SDKs

Este directorio contiene las bibliotecas de cliente (SDKs) para integrar aplicaciones y servicios con el Identity Provider de **AngelPixel**.

## SDKs Disponibles

| Lenguaje / Ecosistema | Directorio | Descripción | Estado |
| :--- | :--- | :--- | :--- |
| **TypeScript / Node.js** | [`typescript/`](./typescript/) | Cliente oficial para navegadores, Node.js y microservicios satélites | **Producción** (v0.1.0) |
| **Python** | `python/` | Próximamente (Planificado) | En Especificación |

## Arquitectura de los SDKs

Los SDKs siguen una arquitectura modular y consistente:
- **`client`**: Instancia unificada con sub-recursos (`auth`, `users`, `oauth2`).
- **`auth`**: Gestión de tokens con *Smart In-Memory Caching* y refresco preventivo automático.
- **`resources`**: Implementación tipada para cada slice de la API (`Register`, `Me`, `ValidateOrigin`, `OAuth2Token`).
- **`errors`**: Jerarquía fuertemente tipada de excepciones HTTP y de protocolo OAuth2 RFC 6749.

