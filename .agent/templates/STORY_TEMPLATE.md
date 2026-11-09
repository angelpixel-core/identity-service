---
id: "US-[ID]"
title: "[Título Breve del Feature]"
epic:
  id: "EPIC-[ID]"
  name: "[Nombre de la Épica]"
status: draft # [draft | planned | in_progress | in_review | completed | blocked | archived]
priority: P1 # [P0 | P1 | P2 | P3]
bounded_context: identity
subdomain: "[subdominio-específico]"
slice_type: command # [command | query | domain | infrastructure | security | web-ui]
timestamps:
  created_at: "YYYY-MM-DDTHH:mm:ss-03:00"
  started_at: null
  completed_at: null
  updated_at: "YYYY-MM-DDTHH:mm:ss-03:00"
traceability:
  adrs:
    - docs/adr/0001-hexagonal-architecture.md
  guidelines: []
  publications: []
  commits: []
tags:
  - identity
  - multitenant
---

# US-[ID]: [Título Breve del Feature]

## 1. Descripción

**Como** [tipo de usuario / tenant / actor del sistema],  
**Quiero** [realizar una acción concreta],  
**Para** [obtener un beneficio o resolver una necesidad de negocio].

---

## 2. Reglas de Negocio e Invariantes del Dominio

1. **Invariante 1:** [Descripción de la regla de negocio del Bounded Context].
2. **Invariante 2:** [Validación de formato o Value Object].
3. **Invariante 3:** [Manejo de errores o excepciones de dominio].

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: [Nombre de la Feature]

  Scenario: [Nombre del escenario principal]
    Given [contexto / estado inicial]
    When [acción o evento ejecutado]
    Then [resultado esperado]
    And [verificación de estado o evento adicional]
```

---

## 4. Cobertura de Pruebas Requerida

- [ ] **Unit Test:** [Especificar qué regla/VO, Entity o UseCase debe testearse]
- [ ] **Integration Test:** [Especificar qué endpoint/query de DB debe testearse]
- [ ] **Acceptance Test (BDD):** [Archivo .feature y step definitions]
- [ ] **E2E / Security Test:** [Flujo crítico de UI/API o arnés de seguridad]

---

## 5. Trazabilidad de Implementación

- **Archivos Modificados / Creados:**
  - `src/contexts/identity/...`
  - `interfaces/...`
  - `tests/...`
- **Commits asociados:**
  - `[hash]`: feat/refactor(scope): descripción
