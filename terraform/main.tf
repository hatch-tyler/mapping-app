# Main Terraform Configuration
# This file orchestrates all modules

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Provider for ACM certificate (must be us-east-1 for CloudFront)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  common_tags = merge(var.tags, {
    Project     = var.project_name
    Environment = var.environment
  })
}

# Data sources
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Route53 Zone (use existing or create new)
data "aws_route53_zone" "main" {
  count = var.create_route53_zone ? 0 : 1
  zone_id = var.route53_zone_id
}

resource "aws_route53_zone" "main" {
  count = var.create_route53_zone ? 1 : 0
  name  = var.domain_name

  tags = local.common_tags
}

locals {
  zone_id = var.create_route53_zone ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.main[0].zone_id
}

# ACM Certificate (CloudFront requires us-east-1)
resource "aws_acm_certificate" "cloudfront" {
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method = "DNS"

  tags = local.common_tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cloudfront_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.cloudfront.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = local.zone_id
}

resource "aws_acm_certificate_validation" "cloudfront" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cloudfront.arn
  validation_record_fqdns = [for record in aws_route53_record.cloudfront_cert_validation : record.fqdn]
}

# ACM Certificate for ALB (in deployment region)
resource "aws_acm_certificate" "alb" {
  domain_name               = "api.${var.domain_name}"
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  tags = local.common_tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "alb_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.alb.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = local.zone_id
}

resource "aws_acm_certificate_validation" "alb" {
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = [for record in aws_route53_record.alb_cert_validation : record.fqdn]
}

# Application Secrets
resource "random_password" "secret_key" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "app_secrets" {
  name_prefix = "${local.name_prefix}-app-secrets-"
  description = "Application secrets for ${local.name_prefix}"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    secret_key             = random_password.secret_key.result
    initial_admin_email    = var.initial_admin_email
    initial_admin_password = random_password.initial_admin_password.result
    initial_admin_full_name = var.initial_admin_full_name
  })
}

resource "random_password" "initial_admin_password" {
  length           = 24
  special          = true
  override_special = "!@#$%^&*"
}

# VPC Module
module "vpc" {
  source = "./modules/vpc"

  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
  tags               = var.tags
}

# S3 Module
module "s3" {
  source = "./modules/s3"

  project_name = var.project_name
  environment  = var.environment
  tags         = var.tags
}

# ALB Module
module "alb" {
  source = "./modules/alb"

  project_name      = var.project_name
  environment       = var.environment
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = aws_acm_certificate_validation.alb.certificate_arn
  tags              = var.tags
}

# Security Group for ECS Tasks (created separately to avoid circular dependency)
resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${local.name_prefix}-ecs-tasks-"
  description = "Security group for ECS Fargate tasks"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [module.alb.alb_security_group_id]
    description     = "Allow traffic from ALB"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ecs-tasks-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# RDS Module
module "rds" {
  source = "./modules/rds"

  project_name               = var.project_name
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  allowed_security_group_ids = [aws_security_group.ecs_tasks.id]
  instance_class             = var.db_instance_class
  allocated_storage          = var.db_allocated_storage
  db_name                    = var.db_name
  db_username                = var.db_username
  multi_az                   = var.db_multi_az
  deletion_protection        = var.db_deletion_protection
  tags                       = var.tags
}

# ECR Repository for backend image
resource "aws_ecr_repository" "backend" {
  name                 = "${local.name_prefix}-backend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus     = "any"
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ECS Module
module "ecs" {
  source = "./modules/ecs"

  project_name               = var.project_name
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  private_subnet_ids         = module.vpc.private_subnet_ids
  alb_security_group_id      = module.alb.alb_security_group_id
  ecs_task_security_group_id = aws_security_group.ecs_tasks.id
  target_group_arn           = module.alb.target_group_arn
  db_credentials_secret_arn  = module.rds.db_credentials_secret_arn
  app_secrets_arn            = aws_secretsmanager_secret.app_secrets.arn
  uploads_bucket_name        = module.s3.uploads_bucket_id
  uploads_access_policy_arn  = module.s3.uploads_access_policy_arn
  backend_image              = "${aws_ecr_repository.backend.repository_url}:latest"
  cpu                        = var.backend_cpu
  memory                     = var.backend_memory
  desired_count              = var.backend_desired_count
  min_count                  = var.backend_min_count
  max_count                  = var.backend_max_count
  upload_max_size_mb         = var.upload_max_size_mb
  cors_origins               = "https://${var.domain_name}"
  tags                       = var.tags
}

# CloudFront Module
module "cloudfront" {
  source = "./modules/cloudfront"

  project_name                = var.project_name
  environment                 = var.environment
  frontend_bucket_id          = module.s3.frontend_bucket_id
  frontend_bucket_arn         = module.s3.frontend_bucket_arn
  frontend_bucket_domain_name = module.s3.frontend_bucket_domain_name
  api_domain_name             = module.alb.alb_dns_name
  domain_name                 = var.domain_name
  certificate_arn             = aws_acm_certificate_validation.cloudfront.certificate_arn
  tags                        = var.tags
}

# DNS Records
resource "aws_route53_record" "frontend" {
  zone_id = local.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.cloudfront.distribution_domain_name
    zone_id                = module.cloudfront.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  zone_id = local.zone_id
  name    = "api.${var.domain_name}"
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }
}
