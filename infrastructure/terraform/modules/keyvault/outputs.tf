output "vault_id" {
  description = "The ID of the Key Vault"
  value       = azurerm_key_vault.this.id
}

output "vault_name" {
  description = "The name of the Key Vault"
  value       = azurerm_key_vault.this.name
}

output "vault_uri" {
  description = "The URI of the Key Vault for performing operations on keys and secrets"
  value       = azurerm_key_vault.this.vault_uri
}

output "secret_ids" {
  description = "Map of secret names to their Key Vault IDs"
  value       = { for k, v in azurerm_key_vault_secret.this : k => v.id }
  sensitive   = true
}
