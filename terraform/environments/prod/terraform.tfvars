# Production Environment Configuration
# Copy this file and customize for your deployment

environment = "prod"
aws_region  = "us-east-1"

# Domain Configuration
# You must own this domain and either:
# 1. Set create_route53_zone = true to create a new hosted zone
# 2. Set route53_zone_id to an existing hosted zone ID
domain_name         = "your-domain.com"  # CHANGE THIS
create_route53_zone = false
route53_zone_id     = ""  # If not creating new zone, set this

# Database Configuration
db_instance_class      = "db.t3.small"  # Upgrade for production
db_allocated_storage   = 50
db_multi_az            = true           # Enable for high availability
db_deletion_protection = true

# ECS Configuration
backend_cpu           = 512   # 0.5 vCPU
backend_memory        = 1024  # 1 GB
backend_desired_count = 2     # Minimum 2 for high availability
backend_min_count     = 2
backend_max_count     = 8

# Application Configuration
upload_max_size_mb      = 500
initial_admin_email     = "admin@your-domain.com"  # CHANGE THIS
initial_admin_full_name = "Administrator"

# Networking
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# Tags
tags = {
  CostCenter = "production"
  Owner      = "ops-team"
}
