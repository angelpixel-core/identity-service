variable "prefix" {
  description = "Naming prefix applied to all resources in this environment"
  type        = string
  default     = "id-local"
}

variable "location" {
  description = "Target Azure region for resources"
  type        = string
  default     = "eastus2"
}

variable "environment" {
  description = "Environment name identifier"
  type        = string
  default     = "local"
}

variable "metadata_host" {
  description = "Floci ARM metadata host endpoint"
  type        = string
  default     = "localhost:4578"
}

variable "postgres_admin_login" {
  description = "Administrator login username for PostgreSQL Flexible Server"
  type        = string
  default     = "pgadmin"
}

variable "postgres_admin_password" {
  description = "Administrator password for PostgreSQL Flexible Server"
  type        = string
  default     = "SuperP@ssw0rdLocal123!"
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT Secret for identity token signing"
  type        = string
  default     = "super-secret-tenant-key-minimum-32-characters"
  sensitive   = true
}

variable "database_url" {
  description = "Database connection string"
  type        = string
  default     = "postgresql://pgadmin:SuperP@ssw0rdLocal123!@localhost:5432/identity_db"
  sensitive   = true
}

variable "redis_url" {
  description = "Redis connection string"
  type        = string
  default     = "redis://localhost:6379"
  sensitive   = true
}

variable "encryption_key" {
  description = "256-bit AES encryption key for tenant session secrets"
  type        = string
  default     = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  sensitive   = true
}
