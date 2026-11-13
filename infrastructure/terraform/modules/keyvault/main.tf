resource "azurerm_key_vault" "this" {
  name                       = var.vault_name
  location                   = var.location
  resource_group_name        = var.resource_group_name
  tenant_id                  = var.tenant_id
  sku_name                   = var.sku_name
  purge_protection_enabled   = var.purge_protection_enabled
  soft_delete_retention_days = var.soft_delete_retention_days
  tags                       = var.tags
}

resource "azurerm_key_vault_access_policy" "admin" {
  key_vault_id = azurerm_key_vault.this.id
  tenant_id    = var.tenant_id
  object_id    = var.object_id

  key_permissions = [
    "Get",
    "List",
    "Create",
    "Delete",
    "Update",
    "Recover",
    "Purge"
  ]

  secret_permissions = [
    "Get",
    "List",
    "Set",
    "Delete",
    "Recover",
    "Purge"
  ]
}

resource "azurerm_key_vault_secret" "this" {
  for_each     = toset(keys(var.secrets))
  name         = each.key
  value        = var.secrets[each.key]
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_key_vault_access_policy.admin]
}
