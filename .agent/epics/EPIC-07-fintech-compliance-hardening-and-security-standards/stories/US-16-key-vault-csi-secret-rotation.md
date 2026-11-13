---
id: US-16
title: "Azure Key Vault CSI Driver Secret Rotation & In-Process Dynamic Reload"
epic:
  id: EPIC-07
  name: "Fintech Compliance, Hardening & Security Standards"
status: completed
priority: P1
bounded_context: security
subdomain: secrets-management
slice_type: infrastructure-and-runtime
regulatory_standards:
  - "PCI-DSS v4.0 Req 3.6 (Cryptographic Key Management & Secret Rotation)"
  - "SOC 2 Type II CC6.1 (Logical Access Controls & Key Vault Management)"
timestamps:
  created_at: "2026-11-13T13:30:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-17-key-vault-csi-secret-rotation.md
  publications:
    - .agent/publications/ARTICLE-13-fintech-compliance-hardening.md
tags:
  - key-vault
  - csi-driver
  - secret-rotation
  - zero-downtime
  - file-watcher
  - pci-dss
  - soc2
---

# US-16: Azure Key Vault CSI Driver Secret Rotation & In-Process Dynamic Reload

**Epic:** [EPIC-07: Fintech Compliance, Hardening & Security Standards](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `security` / `secrets-management`  
**Slice Type:** Runtime Security & Infrastructure Slice  
**Regulatory Framework:** PCI-DSS v4.0 (Req 3.6) · SOC 2 Type II (CC6.1)  

---

## 1. Descripción

**Como** Arquitecto de Seguridad y Oficial de Cumplimiento FinTech,  
**Quiero** que `identity-service` detecte de forma automática y asimile en caliente la rotación de credenciales de base de datos y llaves criptográficas inyectadas por Azure Key Vault Secrets Store CSI Driver en `/mnt/secrets-store/`,  
**Para** garantizar una rotación periódica y determinista de secretos sin requerir el reinicio destructivo de Pods (*Zero-Downtime Secret Rotation*), erradicando credenciales estáticas y cumpliendo estrictamente con PCI-DSS Req 3.6 y SOC 2 CC6.1.

---

## 2. Reglas Técnicas e Invariantes de Seguridad

1. **Configuración de Auto-Rotación en Kubernetes SecretProviderClass:**
   * La propiedad `rotationPollInterval` del driver CSI debe configurarse en `2m` (2 minutos) en `deployments/helm/identity-service/templates/secret-provider-class.yaml`.
   * El driver CSI de Azure Key Vault debe montar dinámicamente las versiones actualizadas de `database-password`, `jwt-private-key` y `jwt-public-key` en la ruta de volumen `/mnt/secrets-store/`.
2. **Observador de Archivos en Proceso (*In-Process File Watcher*):**
   * Se debe implementar un servicio desacoplado `SecretWatcherService` en Node.js utilizando `fs.watch` con debounce y verificación de integridad criptográfica (checksum SHA-256) para evitar falsos positivos o lecturas parciales durante la reescritura atómica del enlace simbólico (*symlink swap*) que realiza Kubernetes.
3. **Renovación en Memoria del Pool de PostgreSQL:**
   * Al detectar una modificación en `database-password`, el servicio de base de datos debe actualizar las credenciales del pool `pg.Pool` de forma segura:
     * Drenar gradualmente las conexiones antiguas sin abortar transacciones en vuelo.
     * Establecer las nuevas conexiones con la contraseña rotada.
4. **Rollover de Claves Criptográficas JWT (Graceful Key Rollover):**
   * Al rotar claves asimétricas RS256:
     * La nueva clave privada asume la firma de tokens subsiguientes.
     * La clave pública previa se retiene temporalmente en memoria (ventana de gracia configurable de 15 minutos) para validar tokens en tránsito emitidos justo antes de la rotación.
5. **Auditoría de Eventos de Rotación:**
   * Cada detección y aplicación de rotación debe emitir un evento estructurado de auditoría `SECRET_ROTATION_SUCCESS` o `SECRET_ROTATION_FAILURE` con severidad `NOTICE` o `ALERT`.

---

## 3. Escenarios de Aceptación BDD (Living Documentation)

```gherkin
Feature: Rotación Inyectada de Secretos con Azure Key Vault CSI Driver

  Scenario: Detección y asimilación en caliente de nueva contraseña de PostgreSQL
    Given que identity-service está operando normalmente con 2 réplicas saludables
    And las credenciales están montadas en "/mnt/secrets-store/database-password"
    When Azure Key Vault rota la contraseña y el CSI Driver actualiza el archivo montado
    Then el servicio SecretWatcherService detecta la modificación mediante checksum SHA-256
    And el pool de conexiones PostgreSQL se renueva de forma transparente
    And ninguna petición HTTP activa experimenta fallos de conectividad (Zero-Downtime)
    And se registra un evento de auditoría con tipo "SECRET_ROTATION_SUCCESS"

  Scenario: Rollover de clave privada JWT con preservación de clave pública previa
    Given que identity-service firma tokens con la clave activa "key-v1"
    When se inyecta una nueva clave privada "key-v2" en "/mnt/secrets-store/jwt-private-key"
    Then los nuevos tokens emitidos son firmados con "key-v2"
    And los tokens previamente firmados con "key-v1" continúan siendo válidos durante la ventana de gracia
    And el endpoint JWKS publica ambas claves públicas para los clientes satélites
```

---

## 4. Definición de Hecho (Definition of Done)

- [x] `SecretWatcherService` implementado con debounce, checksum y manejo seguro de symlinks.
- [x] Recarga en caliente del pool de base de datos validada con pruebas de concurrencia.
- [x] Key rollover asimétrico validado sin invalidación prematura de tokens vigentes.
- [x] Helm Chart parametrizado con `rotationPollInterval: 2m`.
- [x] Pruebas unitarias e integradas cubriendo escenarios de rotación y error.
