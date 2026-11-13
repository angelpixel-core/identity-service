variable "registry_name" {
  description = "Name of the Azure Container Registry (must be globally unique, alphanumeric only, 5-50 characters)"
  type        = string
}

variable "location" {
  description = "Azure region where the container registry will be created"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the parent resource group"
  type        = string
}

variable "sku" {
  description = "The SKU tier of the container registry (Basic, Standard, Premium)"
  type        = string
  default     = "Basic"
}

variable "admin_enabled" {
  description = "Whether the admin user is enabled for the container registry"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Map of tags to assign to the container registry"
  type        = map(string)
  default     = {}
}
