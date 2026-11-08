# Resources

Módulos de recursos de API desacoplados que exponen operaciones de alto nivel sobre las rutas de AngelPixel Identity Service:
- `AuthResource`: Registro de usuarios multi-tenant (`POST /api/v1/auth/register`).
- `UsersResource`: Consulta de perfil de usuario (`GET /api/v1/auth/me`).
- `OAuth2Resource`: Validación de origen (`POST /api/v1/oauth2/clients/validate`) y tokens M2M (`POST /api/v1/oauth2/token`).

