---
id: US-12
title: "Terraform Azure Resources Provisioning over Floci"
epic:
  id: EPIC-06
  name: "Cloud Infrastructure & Container Orchestration (Azure & Floci)"
status: planned
priority: P1
bounded_context: infrastructure
subdomain: cloud-provisioning
slice_type: infrastructure
timestamps:
  created_at: "2026-11-10T14:15:00-03:00"
  started_at: null
  completed_at: null
  updated_at: "2026-11-10T14:15:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-13-terraform-floci-provisioning.md
  publications:
    - .agent/publications/ARTICLE-12-cloud-infrastructure-azure-floci.md
  commits: []
tags:
  - terraform
  - azure
  - floci
  - aks
  - postgresql-flexible
  - key-vault
  - acr
  - iac
---

# US-12: Terraform Azure Resources Provisioning over Floci

**Epic:** [EPIC-06: Cloud Infrastructure & Container Orchestration (Azure & Floci)](../README.md)  
**Status:** Planned  
**Domain / Bounded Context:** `infrastructure` / `cloud-provisioning`  
**Slice Type:** Infrastructure as Code (IaC) Provisioning Slice  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  
**Plataforma de Emulación:** [Floci (floci-az)](https://github.com/floci-io/floci)

---

## 1. Descripción

**Como** Ingeniero Cloud / DevOps y Desarrollador Full Stack,  
**Quiero** aprovisionar mediante Terraform modular todos los recursos gestionados de Azure necesarios para el ecosistema de `identity-service` ejecutándose contra el emulador local Floci,  
**Para** garantizar una infraestructura reproducible, parametrizable y segura sin incurrir en costes de nube durante el ciclo de vida de desarrollo y pruebas.

---

## 2. Reglas Técnicas e Invariantes de Infraestructura

1. **Configuración de Provider `azurerm` contra Floci:**
   * El provider `azurerm` en el entorno local debe apuntar su metadata endpoint a Floci (`metadata_host = "localhost:4577"`).
   * La propiedad `resource_provider_registrations = "none"` debe estar habilitada para omitir llamadas a la API pública de registro de proveedores de Azure.
   * Se deben definir credenciales dummy consistentes (GUIDs simulados para `subscription_id`, `tenant_id`, `client_id` y string para `client_secret`).
2. **Modularidad Desacoplada (`infrastructure/terraform/modules/`):**
   * Cada recurso o grupo de recursos afines debe residir en un módulo propio con sus respectivos `main.tf`, `variables.tf` y `outputs.tf`:
     * `modules/aks`: Define clúster AKS con nodo de sistema, CNI network profile y RBAC.
     * `modules/postgres`: Flexible Server PostgreSQL con base `identity_db`, autenticación por contraseña y SSL mandatorio.
     * `modules/keyvault`: Vault con SKU estándar, retención de borrado suave y directivas de acceso.
     * `modules/acr`: Registro de contenedores con SKU estándar e integración de permisos pull hacia AKS.
     * `modules/storage`: Storage Account con contenedor privado de blobs para auditorías y exportaciones.
     * `modules/log_analytics`: Workspace centralizado para métricas y logs de auditoría.
3. **Gestión Declarativa de Secretos en Key Vault:**
   * Los secretos críticos de aplicación (`jwt-secret`, `database-url`, `redis-url`, `encryption-key`) se gestionan mediante recursos `azurerm_key_vault_secret`, desacoplando las credenciales del código fuente.
4. **Composición de Entornos (`environments/local/`):**
   * El entorno local debe invocar todos los módulos pasando prefijos consistentes de nombrado (`id-local-*`) y etiquetas comunes (`Environment = "local"`, `Project = "identity-service"`, `ManagedBy = "terraform"`).
5. **Idempotencia y Validación Sintáctica:**
   * La configuración debe aprobar estrictamente `terraform validate`, `terraform fmt -check` y generar planes limpios con `terraform plan`.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Terraform Azure Resources Provisioning over Floci
  As a Cloud Engineer
  I want to provision Azure resources using modular Terraform against local Floci
  So that I have an enterprise-grade cloud topology without external cloud billing

  Scenario: Validating Terraform syntax and module structure
    Given the Terraform modules are organized under "infrastructure/terraform/modules"
    When I execute "terraform validate" in the local environment
    Then the configuration should be reported as syntactically valid
    And all variable contracts and outputs must be strongly typed

  Scenario: Plan execution against Floci ARM metadata emulator
    Given Floci is running locally on port 4577
    And the "azurerm" provider is configured with "metadata_host = localhost:4577"
    When I run "terraform plan" for the local environment
    Then Terraform must plan the creation of:
      | Resource Type                              | Target Component          |
      | azurerm_resource_group                     | Core Resource Group       |
      | azurerm_kubernetes_cluster                 | AKS Managed Cluster       |
      | azurerm_postgresql_flexible_server         | PostgreSQL Flexible Server|
      | azurerm_postgresql_flexible_server_database| identity_db               |
      | azurerm_key_vault                          | Application Key Vault     |
      | azurerm_key_vault_secret                   | JWT & DB Secrets          |
      | azurerm_container_registry                 | ACR Registry              |
      | azurerm_storage_account                    | Blob Storage              |
      | azurerm_log_analytics_workspace            | Log Analytics             |
    And no errors regarding Azure cloud authentication or subscription limits should occur
```

---

## 4. Definición de Hecho (DoD)

- [x] Contenedor Floci orquestado vía Docker Compose en `compose.yml` (profiles: `cloud`, `infra`).
- [ ] 6 módulos Terraform reutilizables (`aks`, `postgres`, `keyvault`, `acr`, `storage`, `log_analytics`).
- [ ] Entorno `environments/local/` configurado con variables y outputs correspondientes.
- [ ] `terraform validate` y `terraform fmt` pasando sin errores.
- [ ] Registro en `TRACEABILITY_MATRIX.md`.
