---
id: US-19
title: "Structured Security Audit Logging (12-Factor stdout NDJSON) & Azure Log Analytics Ingestion"
epic:
  id: EPIC-07
  name: "Fintech Compliance, Hardening & Security Standards"
status: completed
priority: P1
bounded_context: security
subdomain: audit-and-observability
slice_type: logging-and-compliance
regulatory_standards:
  - "PCI-DSS v4.0 Req 10.2 & 10.5 (Audit Logging & Immutable Trail Protection)"
  - "SOC 2 Type II CC7.2 (System Operation Monitoring & Anomaly Detection)"
timestamps:
  created_at: "2026-11-13T13:30:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-20-immutable-audit-log-analytics.md
  publications:
    - .agent/publications/ARTICLE-16-immutable-audit-log-analytics.md
tags:
  - audit-logging
  - 12-factor
  - ndjson
  - log-analytics
  - immutability
  - pci-dss
  - soc2
---

# US-19: Structured Security Audit Logging (12-Factor stdout NDJSON) & Azure Log Analytics Ingestion

**Epic:** [EPIC-07: Fintech Compliance, Hardening & Security Standards](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `security` / `audit-and-observability`  
**Slice Type:** Audit Trail & Platform Ingestion Slice  
**Regulatory Framework:** PCI-DSS v4.0 (Req 10.2 & 10.5) · SOC 2 Type II (CC7.2)  

---

## 1. Descripción

**Como** Auditor de Seguridad y Oficial de Cumplimiento FinTech,  
**Quiero** que `identity-service` emita todas sus bitácoras de auditoría de seguridad en formato estructurado NDJSON a través de `stdout` (12-Factor App) con metadatos contextuales estandarizados y clasificación de cumplimiento, siendo recolectadas por el clúster e ingeridas en Azure Log Analytics Workspace bajo políticas de retención inmutables,  
**Para** garantizar una pista de auditoría forense inalterable, trazable y auditable frente a entes reguladores, satisfaciendo plenamente PCI-DSS Req 10.2 / 10.5 y SOC 2 CC7.2.

---

## 2. Reglas Técnicas e Invariantes de Seguridad

1. **Esquema Estructurado NDJSON para Eventos de Seguridad:**
   * La aplicación debe emitir por `stdout` eventos en formato JSON de una sola línea (NDJSON) conforme al siguiente esquema bancario:
     ```json
     {
       "timestamp": "2026-11-13T16:30:00.000Z",
       "logType": "SECURITY_AUDIT",
       "eventType": "TOKEN_ISSUED",
       "severity": "INFO",
       "tenantId": "alpha-corp",
       "actor": {
         "userId": "usr_9b1deb4d",
         "type": "USER",
         "ip": "10.244.0.5"
       },
       "trace": {
         "requestId": "req_8f1b2c3d",
         "correlationId": "corr_9a8b7c"
       },
       "compliance": {
         "pciRequirement": "10.2.1",
         "soc2Criteria": "CC7.2",
         "retentionCategory": "AUDIT_IMMUTABLE"
       },
       "action": "oauth2_token_issued",
       "status": "SUCCESS",
       "details": {}
     }
     ```
2. **Eventos de Seguridad Mandatorios a Registrar (PCI Req 10.2):**
   * Intentos de autenticación exitosos y fallidos (`AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILURE`).
   * Emisión, revocación y rotación de tokens (`TOKEN_ISSUED`, `TOKEN_REVOKED`, `REFRESH_ROTATED`).
   * Violaciones de acceso entre organizaciones (`CROSS_TENANT_VIOLATION`).
   * Eventos de ciclo de vida criptográfico y rotación de secretos (`SECRET_ROTATION_SUCCESS`, `SECRET_ROTATION_FAILURE`).
   * Denegaciones de autorización a nivel de origen o cliente OAuth2 (`CLIENT_ORIGIN_DENIED`).
3. **Ofuscación y Sanitización Estricta (PCI Req 3.4 / 10.5):**
   * Queda prohibida la inclusión en los logs de datos confidenciales en texto plano:
     * Contraseñas o hashes de contraseñas (`[REDACTED]`).
     * Códigos de autorización o refresh tokens (`[REDACTED]`).
     * Números de tarjetas o información bancaria directa.
4. **Ingesta y Preservación Inmutable en Azure Log Analytics:**
   * El DaemonSet de Kubernetes (Azure Monitor Container Insights / Fluentbit) recolecta el flujo de `stdout`.
   * En Terraform (`modules/log_analytics`), el workspace debe configurar `retention_in_days = 365` (1 año mandatorio por PCI-DSS) con políticas de bloqueo de edición o borrado de datos históricos (*WORM compliance*).

---

## 3. Escenarios de Aceptación BDD (Living Documentation)

```gherkin
Feature: Emisión Estructurada y Preservación de Bitácoras de Seguridad

  Scenario: Emisión de evento de auditoría estructurado ante login exitoso
    Given un usuario del tenant "alpha-corp" autenticándose mediante credenciales válidas
    When la autenticación culmina exitosamente
    Then el logger emite a stdout un objeto NDJSON con logType "SECURITY_AUDIT"
    And contiene tenantId, actor.userId, trace.requestId y etiquetas de compliance PCI-DSS
    And no contiene contraseñas ni tokens en texto plano

  Scenario: Detección y registro de violación de seguridad por acceso cruzado
    Given un intento malicioso de consulta de recursos de "beta-corp" con token de "alpha-corp"
    When el CrossTenantZeroTrustGuard intercepta la discrepancia
    Then la petición es abortada con código 403 Forbidden
    And se emite un evento "CROSS_TENANT_VIOLATION" con severidad "ALERT"
    And el evento es recolectado por el DaemonSet para su análisis forense en Log Analytics
```

---

## 4. Definición de Hecho (Definition of Done)

- [x] Adaptador `ConsoleSecurityAuditLogger` implementado con formato NDJSON bancario y sanitización de datos confidenciales.
- [x] Enriquecimiento automático con `tenantId`, `userId`, `requestId` y tags regulatorios.
- [x] Pruebas unitarias verificando la estructura de eventos y la ausencia de datos sensibles.
- [x] Módulo Terraform `modules/log_analytics` validado con retención de 365 días en `npm run test:infra`.
