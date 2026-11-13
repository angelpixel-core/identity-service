output "registry_id" {
  description = "The ID of the Azure Container Registry"
  value       = azurerm_container_registry.this.id
}

output "registry_name" {
  description = "The name of the Azure Container Registry"
  value       = azurerm_container_registry.this.name
}

output "login_server" {
  description = "The URL that can be used to log into the container registry"
  value       = azurerm_container_registry.this.login_server
}

output "admin_username" {
  description = "The Username associated with the Container Registry Admin account"
  value       = azurerm_container_registry.this.admin_username
}

output "admin_password" {
  description = "The Password associated with the Container Registry Admin account"
  value       = azurerm_container_registry.this.admin_password
  sensitive   = true
}
