variable "cluster_name" {
  description = "Name of the Azure Kubernetes Service (AKS) managed cluster"
  type        = string
}

variable "location" {
  description = "Azure region where the AKS cluster will be created"
  type        = string
}

variable "resource_group_name" {
  description = "Name of the parent resource group"
  type        = string
}

variable "dns_prefix" {
  description = "DNS prefix specified when creating the managed cluster"
  type        = string
}

variable "node_count" {
  description = "Initial number of nodes in the default system node pool"
  type        = number
  default     = 1
}

variable "vm_size" {
  description = "The size of the Virtual Machines to use for the agent pool"
  type        = string
  default     = "Standard_B2s"
}

variable "os_disk_size_gb" {
  description = "The size of the OS Disk in GB for nodes in the agent pool"
  type        = number
  default     = 30
}

variable "network_plugin" {
  description = "Network plugin to use for networking (kubenet or azure)"
  type        = string
  default     = "kubenet"
}

variable "acr_id" {
  description = "Optional ID of an Azure Container Registry to attach AcrPull permissions to AKS"
  type        = string
  default     = null
}

variable "attach_acr" {
  description = "Whether to attach ACR role assignment AcrPull to AKS"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Map of tags to assign to the AKS cluster"
  type        = map(string)
  default     = {}
}
