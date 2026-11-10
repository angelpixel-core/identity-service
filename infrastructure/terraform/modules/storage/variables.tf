variable "storage_account_name" {
  description = "Name of the storage account (must be unique globally, 3-24 characters, lowercase alphanumeric only)"
  type        = string
}

variable "location" {
  description = "Azure region where the storage account will be created"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the parent resource group"
  type        = string
}

variable "account_tier" {
  description = "Defines the Tier to use for this storage account (Standard or Premium)"
  type        = string
  default     = "Standard"
}

variable "account_replication_type" {
  description = "Defines the type of replication to use for this storage account (LRS, GRS, RAGRS, ZRS, GZRS, RAGZRS)"
  type        = string
  default     = "LRS"
}

variable "account_kind" {
  description = "Defines the Kind of account (StorageV2, BlobStorage, FileStorage, BlockBlobStorage)"
  type        = string
  default     = "StorageV2"
}

variable "container_names" {
  description = "List of blob container names to create within the storage account"
  type        = list(string)
  default     = ["audit-logs", "identity-backups"]
}

variable "tags" {
  description = "Map of tags to assign to the storage account"
  type        = map(string)
  default     = {}
}
