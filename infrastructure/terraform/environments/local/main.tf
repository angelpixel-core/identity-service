locals {
  common_tags = {
    Environment = var.environment
    Project     = "identity-service"
    ManagedBy   = "terraform"
  }

  clean_prefix = replace(var.prefix, "-", "")
}

resource "azurerm_resource_group" "this" {
  name     = "${var.prefix}-rg"
  location = var.location
  tags     = local.common_tags
}

module "log_analytics" {
  source = "../../modules/log_analytics"

  workspace_name      = "${var.prefix}-law"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  retention_in_days   = 365
  tags = merge(local.common_tags, {
    Compliance = "PCI-DSS-10.5/SOC2-CC7.2"
    Retention  = "Immutable-365d"
  })
}

module "storage" {
  source = "../../modules/storage"

  storage_account_name = "${local.clean_prefix}st"
  location             = azurerm_resource_group.this.location
  resource_group_name  = azurerm_resource_group.this.name
  container_names      = ["audit-logs", "identity-backups"]
  tags                 = local.common_tags
}

module "keyvault" {
  source = "../../modules/keyvault"

  vault_name                 = "${var.prefix}-kv"
  location                   = azurerm_resource_group.this.location
  resource_group_name        = azurerm_resource_group.this.name
  tenant_id                  = "00000000-0000-0000-0000-000000000000"
  object_id                  = "00000000-0000-0000-0000-000000000000"
  purge_protection_enabled   = false
  soft_delete_retention_days = 7

  secrets = {
    "jwt-secret"     = var.jwt_secret
    "database-url"   = var.database_url
    "redis-url"      = var.redis_url
    "encryption-key" = var.encryption_key
  }

  tags = local.common_tags
}

module "postgres" {
  source = "../../modules/postgres"

  server_name            = "${var.prefix}-psql"
  location               = azurerm_resource_group.this.location
  resource_group_name    = azurerm_resource_group.this.name
  administrator_login    = var.postgres_admin_login
  administrator_password = var.postgres_admin_password
  database_name          = "identity_db"
  tags                   = local.common_tags
}

module "acr" {
  source = "../../modules/acr"

  registry_name       = "${local.clean_prefix}acr"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "Basic"
  admin_enabled       = true
  tags                = local.common_tags
}

module "aks" {
  source = "../../modules/aks"

  cluster_name        = "${var.prefix}-aks"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  dns_prefix          = "${var.prefix}-k8s"
  node_count          = 1
  vm_size             = "Standard_B2s"
  attach_acr          = true
  acr_id              = module.acr.registry_id
  tags                = local.common_tags
}
