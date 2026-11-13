output "server_id" {
  description = "The ID of the PostgreSQL Flexible Server"
  value       = azurerm_postgresql_flexible_server.this.id
}

output "server_name" {
  description = "The name of the PostgreSQL Flexible Server"
  value       = azurerm_postgresql_flexible_server.this.name
}

output "server_fqdn" {
  description = "The FQDN of the PostgreSQL Flexible Server"
  value       = azurerm_postgresql_flexible_server.this.fqdn
}

output "administrator_login" {
  description = "The administrator login username"
  value       = azurerm_postgresql_flexible_server.this.administrator_login
}

output "database_id" {
  description = "The ID of the created PostgreSQL database"
  value       = azurerm_postgresql_flexible_server_database.this.id
}

output "database_name" {
  description = "The name of the created PostgreSQL database"
  value       = azurerm_postgresql_flexible_server_database.this.name
}
