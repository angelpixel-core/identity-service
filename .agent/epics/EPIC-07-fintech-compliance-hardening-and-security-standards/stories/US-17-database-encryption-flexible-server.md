---
id: US-17
title: "Database Encryption In-Flight (TLS 1.3/1.2) & At-Rest (CMK) for PostgreSQL Flexible Server"
epic:
  id: EPIC-07
  name: "Fintech Compliance, Hardening & Security Standards"
status: in_progress
priority: P1
bounded_context: infrastructure
subdomain: database-security
slice_type: infrastructure-and-security
regulatory_standards:
  - "PCI-DSS v4.0 Req 4.1 (Strong Cryptography for Sensitive Data in Transit)"
  - "SOC 2 Type II CC6.7 (Transmission and Storage Data Encryption)"
timestamps:
  created_at: "2026-11-13T13:30:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-18-database-encryption-flexible-server.md
  publications:
    - .agent/publications/ARTICLE-14-database-encryption-flexible-server.md
tags:
  - postgresql
  - tls
  - encryption-in-transit
  - encryption-at-rest
  - cmk
  - key-vault
  - pci-dss
  - soc2
---

# US-17: Database Encryption In-Flight (TLS 1.3/1.2) & At-Rest (CMK) for PostgreSQL Flexible Server

**Epic:** [EPIC-07: Fintech Compliance, Hardening & Security Standards](../README.md)  
**Status:** In Progress (Technical implementation merged to `main` via PR #8 `ff05af1`; pending publication ARTICLE-14 & Guideline 18)  
**Domain / Bounded Context:** `infrastructure` / `database-security`  
**Slice Type:** Cryptographic Hardening & Infrastructure Slice  
**Regulatory Framework:** PCI-DSS v4.0 (Req 4.1) · SOC 2 Type II (CC6.7)  

---

## 1. Descripción

**Como** Ingeniero de Seguridad y Administrador de Base de Datos FinTech,  
**Quiero** forzar el cifrado de datos en tránsito con validación criptográfica estricta de certificados CA en `node-pg` (`rejectUnauthorized: true`, TLS 1.3/1.2) y garantizar el cifrado en reposo respaldado por Azure Key Vault en PostgreSQL Flexible Server,  
**Para** proteger de manera absoluta las credenciales, perfiles de usuario y claves criptográficas contra interceptación (Man-in-the-Middle) o exfiltración física de almacenamiento, cumpliendo con PCI-DSS Req 4.1 y SOC 2 CC6.7.

---

## 2. Reglas Técnicas e Invariantes de Seguridad

1. **Cifrado Obligatorio en Tránsito (*In-Flight Encryption*):**
   * El cliente `pg.Pool` en `src/contexts/identity/infrastructure/persistence/database/` debe configurar explícitamente:
     ```typescript
     ssl: {
       rejectUnauthorized: true,
       ca: trustedCaCertificate,
       minVersion: 'TLSv1.2',
     }
     ```
   * Queda terminantemente prohibido el uso de `rejectUnauthorized: false` o configuraciones que ignoren la validación de la cadena de confianza.
   * Cualquier intento de conexión mediante texto plano (sin SSL) o utilizando certificados autofirmados no confiables debe ser abortado inmediatamente por el cliente con un error de apretón de manos (*handshake failure*).
2. **Hardening de PostgreSQL Flexible Server en Terraform (`modules/postgres`):**
   * El recurso `azurerm_postgresql_flexible_server` debe imponer:
     * `ssl_enforcement_enabled = "Enabled"` (bloquea conexiones inseguras a nivel de socket en el motor de base de datos).
     * `ssl_minimal_tls_version_enforced = "TLS1_2"` (prohíbe suites obsoletas TLS 1.0 y 1.1).
3. **Cifrado en Reposo con Llave Gestionada (*Encryption at Rest with CMK / Platform Key*):**
   * El almacenamiento del servidor PostgreSQL debe contar con cifrado transparente de datos (*Transparent Data Encryption - TDE*) respaldado por Azure Key Vault.
4. **Resiliencia de Reconexión Segura:**
   * La reconexión automática del pool ante fallos transitorios debe preservar las invariantes de TLS sin degradar los parámetros de seguridad.

---

## 3. Escenarios de Aceptación BDD (Living Documentation)

```gherkin
Feature: Cifrado Estricto de Base de Datos en Tránsito y en Reposo

  Scenario: Conexión exitosa a PostgreSQL sobre TLS 1.3/1.2 con CA verificada
    Given que el servidor PostgreSQL Flexible Server requiere TLS 1.2 o superior
    And el cliente node-pg cuenta con el certificado CA raíz confiable
    When la aplicación inicializa el pool de conexiones con rejectUnauthorized en true
    Then el apretón de manos TLS se completa satisfactoriamente
    And la sesión ejecuta consultas SQL con canal cifrado de grado enterprise

  Scenario: Bloqueo inmediato ante certificado no confiable o intento de degradación
    Given un intento de conexión con un certificado intermedio revocado o desconocido
    When el cliente node-pg intenta establecer el enlace con la base de datos
    Then la conexión es rechazada inmediatamente con error de verificación de certificado
    And el servicio no expone credenciales ni datos sensibles en texto claro
    And se registra una alerta de seguridad por fallo de handshake TLS
```

---

## 4. Definición de Hecho (Definition of Done)

- [x] Driver `node-pg` configurado con `rejectUnauthorized: true`, `minVersion: 'TLSv1.2'` y soporte de CA raíz (`3a9da41`, `9e7c1eb`, `160d57e`).
- [x] Módulo Terraform `modules/postgres` actualizado con directivas `require_secure_transport = "on"`, `ssl_min_protocol_version = "TLSv1.2"` y soporte dinámico de CMK (`df8b5d7`).
- [x] Pruebas unitarias e integradas verificando el rechazo de conexiones inseguras o certificados malformados (`test_postgres_ssl_config.ts`, `test_database_tls_hardening.ts`).
- [x] Plan de Terraform validado exitosamente en `npm run test:infra`.
- [x] Parametrización y pruebas de empaquetado Helm (`values.yaml`, `values.schema.json`, `npm run test:helm`).
- [x] Fusión a `main` y checks de CI aprobados en GitHub Actions (PR #8 `ff05af1`).
- [ ] Guía interactiva de pruebas (`.agent/guidelines/GUIDELINE-18-database-encryption-flexible-server.md`).
- [ ] Publicación técnica oficial (`.agent/publications/ARTICLE-14-database-encryption-flexible-server.md`).
