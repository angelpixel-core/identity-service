# 2. Uso de Vertical Slice Architecture y Arquitectura Hexagonal (DDD)

* **Status:** Accepted
* **Date:** 2026-11-03
* **Deciders:** Equipo de Arquitectura e Ingeniería

## Contexto y Problema

Tradicionalmente, las aplicaciones web se estructuran en capas técnicas horizontales (Controllers -> Services -> Repositories -> Models). En sistemas con lógica de negocio multitenant y requerimientos mixtos de alta escritura y baja latencia de lectura, esta arquitectura presenta problemas de acoplamiento:
- Los servicios de aplicación crecen como monolitos (e.g. `UserService` con decenas de métodos heterogéneos).
- Un cambio en un caso de uso de lectura puede romper colateralmente un flujo de mutación.
- Los modelos de base de datos se filtran fácilmente hacia los controladores y la lógica de negocio, violando el principio de inversión de dependencias.

## Drivers de la Decisión

- Alta cohesión en torno a casos de uso de negocio específicos (Command vs Query).
- Aislamiento total de las reglas de dominio respecto a frameworks web (Express) y ORMs/bases de datos (PostgreSQL).
- Capacidad de probar los invariantes de negocio de forma 100% aislada en memoria sin I/O.
- Extensibilidad hacia microservicios o interfaces adicionales (CLI, WebSockets) sin reescribir la lógica de aplicación.

## Opciones Consideradas

1. **Arquitectura Tradicional en Capas Horizontales:** Simple de iniciar, pero genera acoplamiento rápido y monolitos de servicios con bajo nivel de testabilidad independiente.
2. **Arquitectura Hexagonal Pura (Ports & Adapters) por Capas:** Aísla el dominio eficazmente, pero organiza los archivos por tipo técnico en lugar de por caso de uso, dificultando la navegación funcional.
3. **Vertical Slice Architecture combinada con Hexagonal y DDD táctico:** Organiza las características por porciones verticales independientes (Commands y Queries dentro de Bounded Contexts), manteniendo el núcleo de dominio (`Aggregate`, `Value Objects`) protegido mediante puertos y adaptadores.

## Decisión

Adoptar **Vertical Slice Architecture con Arquitectura Hexagonal y DDD** conforme a la especificación de `BC_SLICE_TEMPLATE.txt`.
- Cada Bounded Context (`src/contexts/identity/`) contiene su núcleo de dominio puro, sus comandos (`application/commands/<action>/`) y sus queries (`application/queries/<get_data>/`).
- La capa de aplicación define puertos secundarios abstractos (`application/ports/`).
- La capa de infraestructura (`infrastructure/`) implementa los adaptadores técnicos concretos (PostgreSQL, Bcrypt, JWT, In-Memory Cache).
- Los canales conductores (`interfaces/http/`, `interfaces/web/`) consumen la capa de aplicación sin acceder directamente al dominio ni a la persistencia.

## Consecuencias

### Positivas
- Máxima modularidad: agregar, modificar o retirar un caso de uso no afecta a los demás.
- Facilidad para aplicar optimizaciones específicas en lecturas (caching) sin comprometer las transacciones de escritura.
- Pruebas unitarias ultrarrápidas y deterministas en el dominio y en los handlers.

### Negativas / Riesgos
- Mayor cantidad de archivos y carpetas en comparación con una estructura tradicional simple.
- Requiere rigor para no saltarse los puertos ni acoplar adaptadores directamente con los controladores.

