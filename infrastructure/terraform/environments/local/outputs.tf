output "resource_group_name" {
  description = "The name of the resource group"
  value       = azurerm_resource_group.this.name
}

output "log_analytics_workspace_id" {
  description = "The ID of the Log Analytics workspace"
  value       = module.log_analytics.workspace_id
}

output "key_vault_uri" {
  description = "The URI of the Key Vault"
  value       = module.keyvault.vault_uri
}

output "storage_account_blob_endpoint" {
  description = "Primary blob endpoint of the storage account"
  value       = module.storage.primary_blob_endpoint
}

output "postgres_server_fqdn" {
  description = "The FQDN of the PostgreSQL Flexible Server"
  value       = module.postgres.server_fqdn
}

output "postgres_database_name" {
  description = "The name of the identity database"
  value       = module.postgres.database_name
}

output "acr_login_server" {
  description = "The login server URL for Azure Container Registry"
  value       = module.acr.login_server
}

output "aks_cluster_name" {
  description = "The name of the AKS managed cluster"
  value       = module.aks.cluster_name
}

output "aks_cluster_id" {
  description = "The ID of the AKS managed cluster"
  value       = module.aks.cluster_id
}

output "aks_kube_config_raw" {
  description = "Raw Kubernetes configuration string for AKS cluster"
  value       = module.aks.kube_config_raw
  sensitive   = true
}

output "postgres_require_secure_transport" {
  description = "Whether SSL/TLS is strictly enforced on PostgreSQL Flexible Server"
  value       = module.postgres.require_secure_transport
}

output "postgres_ssl_min_protocol_version" {
  description = "The minimum TLS protocol version required by PostgreSQL Flexible Server"
  value       = module.postgres.ssl_min_protocol_version
}

output "postgres_customer_managed_key_id" {
  description = "Customer-managed key ID used for PostgreSQL encryption at rest"
  value       = module.postgres.customer_managed_key_id
}
