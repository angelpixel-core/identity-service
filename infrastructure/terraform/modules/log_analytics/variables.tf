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
  description = "Data retention period in days (Mandatory 365 days for PCI-DSS v4.0 Req 10.5 / SOC 2 CC7.2 audit log compliance)"
  type        = number
  default     = 365

  validation {
    condition     = var.retention_in_days >= 365
    error_message = "Fintech Compliance Violation: retention_in_days must be at least 365 days to satisfy PCI-DSS v4.0 Req 10.5 and SOC 2 CC7.2 audit trail immutability requirements."
  }
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
