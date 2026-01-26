# Staging Environment Configuration
# Cost-optimized for non-production use

environment = "staging"
aws_region  = "us-east-1"

# Domain Configuration
domain_name         = "staging.your-domain.com"  # CHANGE THIS
create_route53_zone = false
route53_zone_id     = ""  # Set to your hosted zone ID

# Database Configuration (smaller for staging)
db_instance_class      = "db.t3.micro"
db_allocated_storage   = 20
db_multi_az            = false  # Single AZ for cost savings
db_deletion_protection = false  # Allow deletion in staging

# ECS Configuration (minimal for staging)
backend_cpu           = 256   # 0.25 vCPU
backend_memory        = 512   # 512 MB
backend_desired_count = 1
backend_min_count     = 1
backend_max_count     = 2

# Application Configuration
upload_max_size_mb      = 100
initial_admin_email     = "admin@your-domain.com"  # CHANGE THIS
initial_admin_full_name = "Administrator"

# Networking
vpc_cidr           = "10.1.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# Tags
tags = {
  CostCenter = "staging"
  Owner      = "dev-team"
}
