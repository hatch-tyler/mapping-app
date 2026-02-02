# Project Configuration
variable "project_name" {
  description = "Name of the project (used for resource naming)"
  type        = string
  default     = "mapping-app"
}

variable "environment" {
  description = "Environment name (prod, staging, dev)"
  type        = string
  default     = "prod"
}

variable "location" {
  description = "Azure region for deployment"
  type        = string
  default     = "East US"
}

# VM Configuration
variable "vm_size" {
  description = "Azure VM size"
  type        = string
  default     = "Standard_B2s"
}

variable "admin_username" {
  description = "SSH admin username for the VM"
  type        = string
  default     = "azureuser"
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key file for VM access"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "ssh_allowed_cidr" {
  description = "CIDR block allowed for SSH access (restrict to your IP)"
  type        = string
  default     = "0.0.0.0/0"
}

# Domain Configuration
variable "domain_name" {
  description = "Domain name for the application (e.g., maps.example.com). Leave empty to use Azure DNS label."
  type        = string
  default     = ""
}

variable "dns_label" {
  description = "Azure DNS label for the public IP (creates <label>.<region>.cloudapp.azure.com)"
  type        = string
  default     = "gis"
}

variable "certbot_email" {
  description = "Email address for Let's Encrypt certificate notifications"
  type        = string
}

# Database Configuration
variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "gis_db"
}

variable "db_username" {
  description = "PostgreSQL username"
  type        = string
  default     = "gis_user"
}

# Data Disk Configuration
variable "data_disk_size_gb" {
  description = "Size of the managed data disk in GB"
  type        = number
  default     = 64
}

# Application Configuration
variable "upload_max_size_mb" {
  description = "Maximum file upload size in MB"
  type        = number
  default     = 500
}

variable "initial_admin_email" {
  description = "Initial admin user email"
  type        = string
}

variable "initial_admin_full_name" {
  description = "Initial admin user full name"
  type        = string
  default     = "Administrator"
}

variable "gunicorn_workers" {
  description = "Number of gunicorn workers for the backend"
  type        = number
  default     = 4
}

# Tags
variable "tags" {
  description = "Additional tags for all resources"
  type        = map(string)
  default     = {}
}
