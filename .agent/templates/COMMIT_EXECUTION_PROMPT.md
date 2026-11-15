# Plantilla de Invocación por Commit (Double-Loop TDD)

Esta plantilla está diseñada para ser copiada, completada e introducida como prompt en cada turno de trabajo con el agente de IA, asegurando una ejecución atómica, rigurosa y sin desvíos conforme a [`.agent/rules/DEVELOPMENT_WORKFLOW.md`](../rules/DEVELOPMENT_WORKFLOW.md).

---

## 📋 Prompt para Copiar y Pegar

```markdown
Actúa como Technical Lead e implementa el siguiente paso de manera estrictamente atómica, siguiendo el protocolo de desarrollo en `.agent/rules/DEVELOPMENT_WORKFLOW.md`:

### 🎯 Parámetros del Paso:
- **User Story:** [ej. US-01]
- **Rama activa:** [ej. feat/US-01-user-registration]
- **Fase del Ciclo:** [OUTER_RED | INNER_RED | INNER_GREEN | INNER_REFACTOR | STORY_CLOSURE]
- **Concepto / Componente:** [ej. Value Object Email (RFC 5322)]
- **Archivo de Código:** [ej. src/contexts/identity/domain/value_objects/email/value.ts]
- **Archivo de Test:** [ej. tests/unit/identity/domain/test_email.ts]
- **Mensaje de Commit:** [ej. test(domain): add failing unit test for email value object [red] | feat(domain): implement email value object to pass test [green]]

---

### 🛠️ Protocolo Obligatorio de Ejecución:

1. **Check-in de Contexto:**
   - Verifica en terminal que la rama actual coincida con la rama activa indicada.
   - Lee la User Story correspondiente y `.agent/memory/TRACEABILITY_MATRIX.md` para validar los contratos.

2. **Ejecución del Paso según Fase:**
   - **Si es RED (Outer o Inner):** Escribe exclusivamente el archivo de test. Ejecuta el test runner en terminal y demuestra en la salida que falla por la ausencia de la implementación requerida.
   - **Si es GREEN:** Escribe la implementación mínima en el archivo de código para satisfacer el test. Ejecuta el test runner y demuestra que pasa a verde.
   - **Si es REFACTOR:** Limpia el código asegurando cumplimiento estricto de `.agent/rules/ARCHITECTURE_RULES.md` (inmutabilidad, sin imports externos en domain, tipado defensivo). Re-ejecuta los tests para certificar cero regresiones.

3. **Actualización de Trazabilidad:**
   - Actualiza el estado del criterio correspondiente en `.agent/memory/TRACEABILITY_MATRIX.md` (registrando el estado y commit hash cuando quede en verde).

4. **Git Stage y Commit Quirúrgico:**
   - Realiza un stage quirúrgico únicamente de los archivos modificados en este paso:
     `git add <archivo_test> <archivo_codigo_si_aplica> .agent/memory/TRACEABILITY_MATRIX.md`
   - Realiza el commit usando exactamente el mensaje indicado arriba.

5. **Hand-off y Detención Inmediata:**
   - Muestra la salida del comando de test en terminal.
   - Muestra el resultado de `git log -1 --stat`.
   - Informa cuál es el siguiente paso lógico sugerido en la hoja de ruta.
   - **DETENTE COMPLETAMENTE:** Espera mi confirmación antes de iniciar cualquier otra acción o commit.

---

### ⛔ Guardrails Inquebrantables:
- ❌ NO avances al siguiente commit ni encadenes tareas de forma autónoma.
- ❌ NO ejecutes `git add .` ni `git add -A`.
- ❌ NO commitees código sin haber ejecutado y mostrado la salida del test en terminal.
- ❌ NO modifiques archivos ajenos a los especificados en este paso.
```

---

## 💡 Ejemplos de Uso Rápido

### Ejemplo 1: Primer paso de una Story (Outer Loop Red)
- **Fase:** `OUTER_RED`
- **Archivo de Test:** `tests/acceptance/features/user_registration.feature`
- **Mensaje de Commit:** `test(acceptance): define gherkin scenarios for US-01 [expected red]`

### Ejemplo 2: Paso Rojo del Dominio (Inner Loop Red)
- **Fase:** `INNER_RED`
- **Archivo de Test:** `tests/unit/identity/domain/test_email.ts`
- **Mensaje de Commit:** `test(domain): add failing test for email value object [red]`

### Ejemplo 3: Paso Verde del Dominio (Inner Loop Green)
- **Fase:** `INNER_GREEN`
- **Archivo de Código:** `src/contexts/identity/domain/value_objects/email/value.ts`
- **Mensaje de Commit:** `feat(domain): implement email value object to pass test [green]`

