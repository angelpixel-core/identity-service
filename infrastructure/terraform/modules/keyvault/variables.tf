variable "vault_name" {
  description = "Name of the Azure Key Vault (must be between 3 and 24 characters)"
  type        = string
}

variable "location" {
  description = "Azure region where the Key Vault will be created"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the parent resource group"
  type        = string
}

variable "tenant_id" {
  description = "Azure Active Directory tenant ID"
  type        = string
}

variable "object_id" {
  description = "Azure AD object ID for administrator access policy"
  type        = string
}

variable "sku_name" {
  description = "The Name of the SKU used for this Key Vault (standard or premium)"
  type        = string
  default     = "standard"
}

variable "purge_protection_enabled" {
  description = "Whether purge protection is enabled on this Key Vault"
  type        = bool
  default     = false
}

variable "soft_delete_retention_days" {
  description = "The number of days that items should be retained once soft-deleted"
  type        = number
  default     = 7
}

variable "secrets" {
  description = "Map of secrets to store in the Key Vault (key = secret name, value = secret value)"
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "tags" {
  description = "Map of tags to assign to the Key Vault"
  type        = map(string)
  default     = {}
}
