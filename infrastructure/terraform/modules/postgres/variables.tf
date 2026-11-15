variable "server_name" {
  description = "Name of the PostgreSQL Flexible Server"
  type        = string
}

variable "location" {
  description = "Azure region where the server will be created"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the parent resource group"
  type        = string
}

variable "administrator_login" {
  description = "Administrator username for PostgreSQL Flexible Server"
  type        = string
  default     = "pgadmin"
}

variable "administrator_password" {
  description = "Administrator password for PostgreSQL Flexible Server"
  type        = string
  sensitive   = true
}

variable "postgres_version" {
  description = "PostgreSQL major version"
  type        = string
  default     = "16"
}

variable "sku_name" {
  description = "The SKU Name for the PostgreSQL Flexible Server"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "storage_mb" {
  description = "Max storage allowed for PostgreSQL Flexible Server in MB"
  type        = number
  default     = 32768
}

variable "database_name" {
  description = "Name of the default PostgreSQL database to create"
  type        = string
  default     = "identity_db"
}

variable "tags" {
  description = "Map of tags to assign to the PostgreSQL server"
  type        = map(string)
  default     = {}
}

variable "customer_managed_key_id" {
  description = "The ID of the Key Vault Key used for CMK encryption at rest"
  type        = string
  default     = null
}

variable "primary_user_assigned_identity_id" {
  description = "The ID of the User Assigned Managed Identity with Key Vault permissions"
  type        = string
  default     = null
}

variable "require_secure_transport" {
  description = "Enforce SSL/TLS connections to PostgreSQL"
  type        = string
  default     = "on"
}

variable "ssl_min_protocol_version" {
  description = "Minimum TLS protocol version allowed (TLSv1.2 or TLSv1.3)"
  type        = string
  default     = "TLSv1.2"
}
