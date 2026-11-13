resource "azurerm_postgresql_flexible_server" "this" {
  name                   = var.server_name
  resource_group_name    = var.resource_group_name
  location               = var.location
  version                = var.postgres_version
  administrator_login    = var.administrator_login
  administrator_password = var.administrator_password
  sku_name               = var.sku_name
  storage_mb             = var.storage_mb
  zone                   = "1"

  dynamic "identity" {
    for_each = var.primary_user_assigned_identity_id != null ? [1] : []
    content {
      type         = "UserAssigned"
      identity_ids = [var.primary_user_assigned_identity_id]
    }
  }

  dynamic "customer_managed_key" {
    for_each = var.customer_managed_key_id != null ? [1] : []
    content {
      key_vault_key_id                  = var.customer_managed_key_id
      primary_user_assigned_identity_id = var.primary_user_assigned_identity_id
    }
  }

  tags = var.tags
}

resource "azurerm_postgresql_flexible_server_configuration" "require_secure_transport" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = var.require_secure_transport
}

resource "azurerm_postgresql_flexible_server_configuration" "ssl_min_protocol_version" {
  name      = "ssl_min_protocol_version"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = var.ssl_min_protocol_version
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "utf8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_all" {
  name             = "allow-dev-access"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "255.255.255.255"
}
