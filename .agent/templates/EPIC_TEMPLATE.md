# EPIC-[ID]: [Título de la Épica]

* **ID:** EPIC-[ID]
* **Bounded Context:** [e.g. identity]
* **Estado:** [Draft | Backlog | In Progress | Done]
* **Responsable / Tech Lead:** [Nombre]
* **Fecha de Inicio:** YYYY-MM-DD
* **Fecha de Cierre:** YYYY-MM-DD

---

## 1. Visión y Objetivos de Negocio

[Descripción breve del valor de negocio que entrega esta épica y el problema que resuelve para los tenants y usuarios.]

### Objetivos Específicos
- [Objetivo 1]
- [Objetivo 2]

---

## 2. Alcance y Vertical Slices

### Write Slices (Commands)
- **US-[ID]:** [Nombre del caso de uso de escritura]
  - *Comando:* `[Action]Command`
  - *Aggregate:* `[AggregateRoot]`

### Read Slices (Queries)
- **US-[ID]:** [Nombre del caso de uso de lectura]
  - *Query:* `[GetData]Query`
  - *Estrategia de lectura:* [Proyección / Caché / Direct Read]

---

## 3. Hoja de Ruta de Implementación (Fases y Commits)

### Fase A: Core Domain & Abstracciones
- `[commit X]`: `feat(domain): [descripción]`
- `[commit X]`: `feat(app): [descripción]`

### Fase B: Infraestructura y Adaptadores
- `[commit X]`: `feat(infra): [descripción]`
- `[commit X]`: `feat(interfaces): [descripción]`

### Fase C: Frontend y UI
- `[commit X]`: `feat(frontend): [descripción]`

### Fase D: Pruebas, Integración y Documentación
- `[commit X]`: `test: [descripción]`
- `[commit X]`: `docs: [descripción]`

---

## 4. Definición de Hecho (Definition of Done - DoD)

- [ ] Todos los criterios de aceptación BDD pasan exitosamente.
- [ ] Pirámide de pruebas completada (Unit, Integration, Acceptance BDD, E2E).
- [ ] Reglas de arquitectura y bounded context respetadas sin dependencias circulares.
- [ ] Matriz de trazabilidad (`TRACEABILITY_MATRIX.md`) actualizada al 100%.
- [ ] Documentación pública y ADRs generados o actualizados.
