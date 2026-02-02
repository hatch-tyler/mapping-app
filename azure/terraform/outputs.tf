# Outputs

output "public_ip" {
  description = "Public IP address of the VM"
  value       = azurerm_public_ip.main.ip_address
}

output "fqdn" {
  description = "Azure DNS FQDN for the VM"
  value       = azurerm_public_ip.main.fqdn
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.main.ip_address}"
}

output "app_url" {
  description = "Application URL"
  value       = local.use_custom_domain ? "https://${local.effective_domain}" : "http://${azurerm_public_ip.main.fqdn}"
}

output "api_docs_url" {
  description = "API documentation URL"
  value       = local.use_custom_domain ? "https://${local.effective_domain}/api/docs" : "http://${azurerm_public_ip.main.fqdn}/api/docs"
}

output "initial_admin_password" {
  description = "Initial admin password (change after first login)"
  value       = random_password.initial_admin_password.result
  sensitive   = true
}

output "db_password" {
  description = "Database password"
  value       = random_password.db_password.result
  sensitive   = true
}

output "effective_domain" {
  description = "The domain being used (custom or Azure FQDN)"
  value       = local.effective_domain
}

output "ssl_note" {
  description = "SSL setup instructions"
  value       = local.use_custom_domain ? "Run ssl-setup.sh after DNS propagates" : "SSL not available with Azure DNS label. Register a domain for HTTPS."
}

output "resource_group_name" {
  description = "Name of the Azure resource group"
  value       = azurerm_resource_group.main.name
}

output "vm_name" {
  description = "Name of the Azure VM"
  value       = azurerm_linux_virtual_machine.main.name
}
