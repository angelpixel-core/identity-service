variable "workspace_name" {
  description = "Name of the Log Analytics workspace"
  type        = string
}

variable "location" {
  description = "Azure region where the workspace will be created"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the parent resource group"
  type        = string
}

variable "retention_in_days" {
  description = "Data retention period in days"
  type        = number
  default     = 30
}

variable "sku" {
  description = "The SKU (pricing tier) of the Log Analytics workspace"
  type        = string
  default     = "PerGB2018"
}

variable "tags" {
  description = "Map of tags to assign to the workspace"
  type        = map(string)
  default     = {}
}
