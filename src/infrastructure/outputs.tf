output "namespace" {
  description = "The namespace the chess system runs in."
  value       = kubernetes_namespace_v1.chess.metadata[0].name
}

output "web_hostname" {
  description = "Hostname the chess site is published on, derived from the platform's base hostname."
  value       = local.web_hostname
}

output "web_url" {
  description = "URL of the chess site. Non-prod serves it with the environment's own self-signed CA."
  value       = "https://${local.web_hostname}/"
}
