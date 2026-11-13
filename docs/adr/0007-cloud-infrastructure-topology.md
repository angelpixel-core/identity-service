# 7. Topología de Infraestructura Cloud, Emulación Local (Floci) y Enrutamiento Ingress con Terminación TLS

* **Status:** Accepted
* **Date:** 2026-11-12
* **Deciders:** Cloud Platform Architect, Principal Security Engineer, DevOps & Identity Team

## Contexto y Problema

El microservicio `identity-service` opera como el Identity Provider (IdP) central y servidor de autorización OpenID Connect (OIDC) para el ecosistema corporativo de AngelSolutions. Como sistema de misión crítica con requerimientos de alta seguridad, aislamiento multi-tenant y estricta disponibilidad, enfrenta tres retos estructurales de infraestructura y despliegue:

1. **Paridad Nube vs. Local sin Costes de Infraestructura:** En entornos de producción sobre Azure y Azure Kubernetes Service (AKS), la infraestructura se gestiona como código (IaC) mediante Terraform (módulos AKS, PostgreSQL Flexible Server, Azure Key Vault, Storage Accounts, Container Registry y Log Analytics). Ejecutar pruebas de despliegue y validación de sintaxis/planes directamente en suscripciones de Azure durante el ciclo de vida de desarrollo genera costes recurrentes, lentitud en los pipelines de CI y dependencia de conectividad externa.
2. **Seguridad en la Capa de Borde (Edge Security & TLS Termination):** Para cumplir con OAuth 2.0 y OpenID Connect Core 1.0, el tráfico entrante debe cursar obligatoriamente sobre HTTPS/TLS. Se requiere terminación TLS en el controlador de borde (Ingress Controller), redirección forzada de tráfico plano (HTTP -> HTTPS), y propagación confiable de cabeceras de proxy (`X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-For`, `X-Real-IP`) hacia el backend Express.
3. **Manejo de Sobrecarga de Cabeceras y Tokens OIDC:** Las peticiones OAuth2/OIDC transportan tokens JWT voluminosos, cabeceras de autorización y múltiples cookies de sesión con firmas criptográficas. Los controladores de borde convencionales con buffers predeterminados (4k u 8k) rechazan peticiones legítimas con errores `413 Request Entity Too Large` o `502 Bad Gateway`.
4. **Ciclo de Vida y Probes de Orquestación en Kubernetes:** El orquestador de contenedores requiere sondas diferenciadas de vida (*Liveness*) y disponibilidad operativa (*Readiness*) para saber cuándo reiniciar un contenedor atascado y cuándo enrutar tráfico de clientes solo cuando la base de datos PostgreSQL y la caché Redis estén operativas.

## Drivers de la Decisión

- **Zero-Cost & Offline Parity:** Capacidad de probar el 100% de la infraestructura Terraform y el enrutamiento Ingress localmente y en CI sin credenciales ni costes reales de Azure.
- **Seguridad en Capa de Borde (Edge-to-Service):** Terminación TLS centralizada, redirección obligatoria a HTTPS y protección de integridad criptográfica para el dominio canónico `auth.angelpixel.local`.
- **Compatibilidad con Grandes Tokens OIDC:** Soporte nativo para cabeceras y buffers de hasta 128k/256k tanto en Ingress de Kubernetes como en la emulación local.
- **Trazabilidad y Observabilidad Distribuida:** Propagación homogénea del identificador de correlación `X-Request-ID` a lo largo de toda la cadena (Cliente -> Ingress -> Backend Express -> Logs).
- **Resiliencia Operativa:** Sondas de salud `/health/live` y `/health/ready` alineadas con las mejores prácticas de Kubernetes.

## Opciones Consideradas

1. **Exposición directa de Express en puerto HTTP plano sin Ingress:** Descartada por vulnerar las especificaciones OIDC de transporte seguro y carecer de paridad con entornos productivos de Kubernetes.
2. **Terminación TLS embebida en Express con certificados NodeJS:** Descartada por sobrecargar el runtime de Node.js, mezclar responsabilidades de infraestructura con lógica de aplicación y romper el patrón estándar de Kubernetes donde Ingress Controller gestiona certificados.
3. **Topología Híbrida Cloud-Native: IaC Modular con Emulación Floci, Ingress-Nginx con Terminación TLS y Emulación Docker Compose:** Opción seleccionada por brindar máxima fidelidad, seguridad de borde y reproducibilidad local.

## Decisión

Se adopta una arquitectura de **Infraestructura Cloud Híbrida y Enrutamiento Ingress con Terminación TLS** compuesta por:

### 1. Aprovisionamiento Modular en Azure Emulado mediante Floci ARM
* Módulos Terraform desacoplados y reutilizables en `infrastructure/terraform/modules/`:
  * `aks`: Clúster administrado con nodo de sistema y asociación de rol `AcrPull`.
  * `postgres`: PostgreSQL Flexible Server con base de datos `identity_db`.
  * `keyvault`: Almacén de secretos seguro (`jwt-private-key`, credenciales de BD y Redis).
  * `storage`: Cuentas de almacenamiento con contenedores para auditoría y respaldos.
  * `acr`: Azure Container Registry para imágenes de contenedores.
  * `log_analytics`: Workspace centralizado para métricas y observabilidad.
* Emulación local completa mediante contenedor `floci/floci-az:latest` (puerto 4577) orquestado en `compose.yml` (perfil `cloud`) y mediado por `scripts/floci-proxy.mjs` (puerto 4578) para compatibilidad con el proveedor `hashicorp/azurerm v3.90+`.
* Verificación automatizada con `npm run test:infra`.

### 2. Capa de Borde Ingress en Kubernetes (Ingress-Nginx)
* Manifiesto estándar `deployments/ingress/ingress.yaml` y Helm Chart template `deployments/helm/identity-service/templates/ingress.yaml`:
  * `ingressClassName: nginx` con anotaciones especializadas:
    * `nginx.ingress.kubernetes.io/ssl-redirect: "true"`
    * `nginx.ingress.kubernetes.io/force-ssl-redirect: "true"`
    * `nginx.ingress.kubernetes.io/proxy-buffer-size: "128k"`
    * `nginx.ingress.kubernetes.io/proxy-buffers-number: "4"`
    * `nginx.ingress.kubernetes.io/proxy-body-size: "10m"`
    * `nginx.ingress.kubernetes.io/configuration-snippet` inyectando cabeceras `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Real-IP` y `X-Request-ID`.
  * Reglas de enrutamiento basadas en Host (`auth.angelpixel.local`) mapeando `/health`, `/.well-known`, `/oauth2`, `/api/v1` y `/` hacia el Service interno `identity-service:4000`.
  * Secret TLS de Kubernetes `identity-tls-secret` (tipo `kubernetes.io/tls`).

### 3. Emulación Local de Ingress con Nginx 1.27 Alpine
* Contenedor `identity-ingress` en `compose.yml` (perfil `ingress`):
  * Mapeo de puertos `80:80` y `443:443`.
  * Redirección forzada HTTP -> HTTPS mediante código **HTTP 308 (Permanent Redirect)** para preservar métodos (`POST`, `PUT`, etc.) y cuerpos de petición entrantes.
  * Configuración de buffers de proxy de 128k (`proxy_buffer_size 128k; proxy_buffers 4 128k; proxy_busy_buffers_size 256k;`).
  * Resolución DNS dinámica mediante Docker embedded DNS (`resolver 127.0.0.11 valid=10s ipv6=off;`) con variables para desacoplar el ciclo de arranque de los contenedores downstream.
  * Mapeo y preservación de correlación distribuida:
    ```nginx
    map $http_x_request_id $correlation_req_id {
        default $http_x_request_id;
        ""      $request_id;
    }
    ```

### 4. Certificados Criptográficos y Autoridad Certificadora Local (PKI)
* Script determinista `deployments/tls/generate-local-certs.sh` (`npm run cert:generate`):
  * Genera una Autoridad Certificadora Raíz propia (`auth-ca.key`, `auth-ca.crt`).
  * Emite certificado de dominio para `auth.angelpixel.local` con extensiones SAN (`DNS:auth.angelpixel.local`, `DNS:localhost`, `IP:127.0.0.1`).
  * Ensambla la cadena completa `auth.angelpixel.local.fullchain.crt`.
  * Genera el Secret de Kubernetes `deployments/tls/identity-tls-secret.yaml` de forma offline mediante `kubectl create secret tls ... --dry-run=client -o yaml`.

### 5. Probes de Kubernetes y Confianza de Proxy en Express Backend
* Express configurado con `app.set('trust proxy', true)`.
* Implementación de endpoints de salud en `interfaces/http/server.ts`:
  * `GET /health/live`: Liveness probe que valida la capacidad de respuesta del runtime y reporta el protocolo detectado (`https`).
  * `GET /health/ready`: Readiness probe que valida conectividad activa con PostgreSQL (`SELECT 1`) y Redis (`PING`).
* Middleware de correlación distribuida que preserva o genera `X-Request-ID` en cada interacción.

## Consecuencias

### Positivas
- **Paridad Arquitectónica Absoluta:** Los mismos conceptos, cabeceras, buffers y certificados modelados para AKS se prueban localmente de forma idéntica.
- **Seguridad Robusta:** Cifrado TLS de extremo a borde verificado en el gateway de entrada con redirección 308 estricta.
- **Validación Automatizada Turnkey:** Pruebas E2E de infraestructura y enrutamiento ejecutables en local y en CI vía `npm run test:infra` y `npm run test:ingress`.
- **Desacoplamiento Criptográfico:** El backend de Node.js no gestiona certificados TLS en el código, delegando la terminación íntegramente al Ingress Controller.

### Trade-offs y Mitigaciones
- **Advertencias de Certificados en Navegadores Locales:** Al usar una CA local autofirmada, los navegadores emiten advertencias de seguridad a menos que se importe `deployments/tls/certs/auth-ca.crt` en el almacén de certificados del sistema operativo (Keychain en macOS / Certificate Store en Linux/Windows). Para pruebas de línea de comandos o automatización, se utiliza `--cacert deployments/tls/certs/auth-ca.crt`.
- **Resolución de Nombres en Local:** El dominio `auth.angelpixel.local` requiere resolución a `127.0.0.1`. Se documenta el uso de `curl --resolve auth.angelpixel.local:443:127.0.0.1` en scripts automatizados y la entrada opcional en `/etc/hosts` para navegación web manual.
