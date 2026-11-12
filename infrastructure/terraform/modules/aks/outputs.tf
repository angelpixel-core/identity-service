output "cluster_id" {
  description = "The ID of the Managed Kubernetes Cluster"
  value       = azurerm_kubernetes_cluster.this.id
}

output "cluster_name" {
  description = "The name of the Managed Kubernetes Cluster"
  value       = azurerm_kubernetes_cluster.this.name
}

output "kube_config_raw" {
  description = "Raw Kubernetes config to be used by kubectl and other compatible tools"
  value       = azurerm_kubernetes_cluster.this.kube_config_raw
  sensitive   = true
}

output "kubelet_identity_object_id" {
  description = "The Object ID of the user-assigned identity used by the Kubelet"
  value       = azurerm_kubernetes_cluster.this.kubelet_identity[0].object_id
}

output "oidc_issuer_url" {
  description = "The OIDC issuer URL for Workload Identity integration"
  value       = azurerm_kubernetes_cluster.this.oidc_issuer_url
}
