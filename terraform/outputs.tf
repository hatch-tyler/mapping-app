# Outputs from all modules

# URLs
output "frontend_url" {
  description = "Frontend application URL"
  value       = "https://${var.domain_name}"
}

output "api_url" {
  description = "Backend API URL"
  value       = "https://api.${var.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (for cache invalidation)"
  value       = module.cloudfront.distribution_id
}

# ECR
output "ecr_repository_url" {
  description = "ECR repository URL for backend image"
  value       = aws_ecr_repository.backend.repository_url
}

# Database
output "rds_endpoint" {
  description = "RDS endpoint"
  value       = module.rds.db_endpoint
  sensitive   = true
}

output "db_credentials_secret_name" {
  description = "Name of Secrets Manager secret containing DB credentials"
  value       = module.rds.db_credentials_secret_name
}

# ECS
output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = module.ecs.service_name
}

output "ecs_log_group" {
  description = "CloudWatch log group for ECS tasks"
  value       = module.ecs.log_group_name
}

# S3
output "uploads_bucket" {
  description = "S3 bucket for file uploads"
  value       = module.s3.uploads_bucket_id
}

output "frontend_bucket" {
  description = "S3 bucket for frontend static files"
  value       = module.s3.frontend_bucket_id
}

# VPC
output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "nat_gateway_ips" {
  description = "NAT Gateway public IPs (for IP whitelisting)"
  value       = module.vpc.nat_gateway_ips
}

# Admin Credentials
output "initial_admin_password" {
  description = "Initial admin password (change after first login)"
  value       = random_password.initial_admin_password.result
  sensitive   = true
}

# DNS
output "nameservers" {
  description = "Route53 nameservers (if zone was created)"
  value       = var.create_route53_zone ? aws_route53_zone.main[0].name_servers : null
}
