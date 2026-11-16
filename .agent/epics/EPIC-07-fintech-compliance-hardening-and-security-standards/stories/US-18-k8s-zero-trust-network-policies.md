---
id: US-18
title: "Kubernetes Zero-Trust NetworkPolicies & Micro-Segmentation in Helm"
epic:
  id: EPIC-07
  name: "Fintech Compliance, Hardening & Security Standards"
status: completed
priority: P1
bounded_context: infrastructure
subdomain: network-security
slice_type: infrastructure-and-orchestration
regulatory_standards:
  - "ISO/IEC 27001:2022 Control A.13.1 (Network Security Management & Segregation)"
  - "SOC 2 Type II CC6.6 (Logical Perimeter Segmentation & Boundary Protection)"
timestamps:
  created_at: "2026-11-13T13:30:00-03:00"
  completed_at: "2026-11-16T00:00:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-19-k8s-zero-trust-network-policies.md
  publications:
    - .agent/publications/ARTICLE-15-k8s-zero-trust-network-policies.md
tags:
  - network-policies
  - zero-trust
  - micro-segmentation
  - helm
  - default-deny
  - iso-27001
  - soc2
---

# US-18: Kubernetes Zero-Trust NetworkPolicies & Micro-Segmentation in Helm

**Epic:** [EPIC-07: Fintech Compliance, Hardening & Security Standards](../README.md)  
**Status:** Ready  
**Domain / Bounded Context:** `infrastructure` / `network-security`  
**Slice Type:** Cloud-Native Orchestration & Security Slice  
**Regulatory Framework:** ISO/IEC 27001:2022 (Control A.13.1) · SOC 2 Type II (CC6.6)  

---

## 1. Descripción

**Como** Ingeniero de Redes y DevSecOps en un ecosistema bancario,  
**Quiero** implementar políticas declarativas de red Zero-Trust (`NetworkPolicies`) integradas en el Helm Chart de `identity-service`, aplicando aislamiento por defecto (*Default-Deny Ingress & Egress*) y listas blancas estrictas basadas en etiquetas de Pods y puertos de transporte,  
**Para** garantizar la microsegmentación absoluta del tráfico, neutralizar ataques de movimiento lateral en caso de vulneración de un contenedor y cumplir rigurosamente con ISO/IEC 27001 Control A.13.1 y SOC 2 CC6.6.

---

## 2. Reglas Técnicas e Invariantes de Seguridad

1. **Aislamiento por Defecto (*Default-Deny All*):**
   * El namespace `identity` debe contar con una directiva `NetworkPolicy` que bloquee por defecto todo el tráfico entrante (*Ingress*) y saliente (*Egress*) para cualquier Pod que carezca de una regla explícita de habilitación:
     ```yaml
     spec:
       podSelector: {}
       policyTypes:
         - Ingress
         - Egress
     ```
2. **Listas Blancas de Entrada (*Ingress Whitelisting*):**
   * Los Pods de `identity-service` únicamente aceptan conexiones entrantes en el puerto `4000/TCP` originadas por el Ingress Controller de Nginx (identificado por su selector de namespace/pod `app.kubernetes.io/name: ingress-nginx`).
   * Queda bloqueada cualquier comunicación directa entre Pods de aplicación no autorizados o desde namespaces no confiables.
3. **Listas Blancas de Salida (*Egress Whitelisting*):**
   * El tráfico de salida de `identity-service` está restringido estrictamente a:
     * **Resolución de Nombres DNS:** Puerto `53` (UDP y TCP) hacia los Pods de `kube-dns` / `coredns` en `kube-system`.
     * **Capa de Persistencia:** Puerto `5432/TCP` hacia la base de datos PostgreSQL Flexible Server.
     * **Capa de Caché / Sesión:** Puerto `6379/TCP` hacia el clúster de Redis.
     * **Servicios de Nube Gestionados:** Puerto `443/TCP` (HTTPS) hacia endpoints de Azure Key Vault y Log Analytics.
4. **Parametrización Modular en Helm:**
   * La plantilla `deployments/helm/identity-service/templates/networkpolicy.yaml` debe ser controlable mediante `networkPolicy.enabled` en `values.yaml` y `values-local.yaml`.
   * En entornos de prueba locales (`values-local.yaml`), se debe permitir tráfico hacia los puertos locales emulados de Floci (`4577` / `4578`).

---

## 3. Escenarios de Aceptación BDD (Living Documentation)

```gherkin
Feature: Microsegmentación Zero-Trust con Kubernetes NetworkPolicies

  Scenario: Tráfico legítimo permitido entre Ingress, Aplicación y Persistencia
    Given que las NetworkPolicies están activas en el namespace "identity"
    When el Ingress Controller reenvía una petición HTTP/HTTPS al puerto 4000 del Pod
    And el Pod consulta a PostgreSQL en el puerto 5432 y a Redis en el puerto 6379
    Then todos los paquetes autorizados son enrutados sin interrupción
    And la resolución de nombres vía CoreDNS en puerto 53 opera exitosamente

  Scenario: Bloqueo de tráfico lateral no autorizado hacia o desde los Pods
    Given un Pod no autorizado ejecutándose en el clúster
    When dicho Pod intenta comunicarse directamente con identity-service en el puerto 4000
    Or identity-service intenta enviar tráfico a un puerto no autorizado (e.g. SSH 22 o HTTP 80 externo)
    Then la NetworkPolicy descarta silenciosamente los paquetes a nivel de kernel CNI
    And la conexión experimenta un timeout determinista sin exponer servicios internos
```

---

## 4. Definición de Hecho (Definition of Done)

- [x] Plantilla `templates/networkpolicy.yaml` implementada con políticas `Default-Deny` e Ingress/Egress whitelists.
- [x] Variables y esquema `networkPolicy` incorporados en `values.yaml` y `values.schema.json`.
- [x] Suite `scripts/test-helm-chart.sh` extendida para auditar el manifiesto `NetworkPolicy` renderizado.
- [x] Verificación de conectividad permitida y bloqueo de tráfico no autorizado en pruebas locales.
