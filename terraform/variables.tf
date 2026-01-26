# Project Configuration
variable "project_name" {
  description = "Name of the project (used for resource naming)"
  type        = string
  default     = "mapping-app"
}

variable "environment" {
  description = "Environment name (prod, staging, dev)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

# Domain Configuration
variable "domain_name" {
  description = "Primary domain name (e.g., example.com)"
  type        = string
}

variable "create_route53_zone" {
  description = "Whether to create a new Route53 hosted zone"
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "Existing Route53 zone ID (if not creating new)"
  type        = string
  default     = ""
}

# Database Configuration
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage for RDS (GB)"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "gis_db"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "gis_user"
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for RDS"
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Enable deletion protection for RDS"
  type        = bool
  default     = true
}

# ECS Configuration
variable "backend_cpu" {
  description = "CPU units for backend container (1024 = 1 vCPU)"
  type        = number
  default     = 256
}

variable "backend_memory" {
  description = "Memory for backend container (MB)"
  type        = number
  default     = 512
}

variable "backend_desired_count" {
  description = "Desired number of backend tasks"
  type        = number
  default     = 1
}

variable "backend_min_count" {
  description = "Minimum number of backend tasks for auto-scaling"
  type        = number
  default     = 1
}

variable "backend_max_count" {
  description = "Maximum number of backend tasks for auto-scaling"
  type        = number
  default     = 4
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

# Networking
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# Tags
variable "tags" {
  description = "Additional tags for all resources"
  type        = map(string)
  default     = {}
}
