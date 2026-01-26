# RDS Module - PostgreSQL with PostGIS

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "allowed_security_group_ids" {
  type = list(string)
}

variable "instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "db_name" {
  type = string
}

variable "db_username" {
  type = string
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  common_tags = merge(var.tags, {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

# Generate random password for RDS
resource "random_password" "db_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# Store credentials in Secrets Manager
resource "aws_secretsmanager_secret" "db_credentials" {
  name_prefix = "${local.name_prefix}-db-credentials-"
  description = "RDS PostgreSQL credentials for ${local.name_prefix}"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_password.result
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    database = var.db_name
    url      = "postgresql://${var.db_username}:${random_password.db_password.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}"
  })

  depends_on = [aws_db_instance.main]
}

# DB Subnet Group
resource "aws_db_subnet_group" "main" {
  name_prefix = "${local.name_prefix}-"
  description = "Database subnet group for ${local.name_prefix}"
  subnet_ids  = var.subnet_ids

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-subnet-group"
  })
}

# Security Group for RDS
resource "aws_security_group" "rds" {
  name_prefix = "${local.name_prefix}-rds-"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = var.vpc_id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-rds-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "rds_ingress" {
  count                    = length(var.allowed_security_group_ids)
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = var.allowed_security_group_ids[count.index]
  description              = "Allow PostgreSQL from ECS tasks"
}

# Parameter Group for PostGIS
resource "aws_db_parameter_group" "postgis" {
  name_prefix = "${local.name_prefix}-postgis-"
  family      = "postgres16"
  description = "PostgreSQL parameter group with PostGIS support"

  # Enable PostGIS extensions
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  # Performance tuning for geospatial workloads
  parameter {
    name  = "work_mem"
    value = "256MB"
  }

  parameter {
    name  = "maintenance_work_mem"
    value = "512MB"
  }

  tags = local.common_tags

  lifecycle {
    create_before_destroy = true
  }
}

# RDS Instance
resource "aws_db_instance" "main" {
  identifier_prefix = "${local.name_prefix}-"

  # Engine
  engine               = "postgres"
  engine_version       = "16.3"
  instance_class       = var.instance_class
  parameter_group_name = aws_db_parameter_group.postgis.name

  # Storage
  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 5 # Auto-scaling up to 5x
  storage_type          = "gp3"
  storage_encrypted     = true

  # Database
  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result

  # Network
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  port                   = 5432

  # Availability
  multi_az = var.multi_az

  # Backup
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"
  copy_tags_to_snapshot   = true
  skip_final_snapshot     = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${local.name_prefix}-final-snapshot" : null

  # Security
  deletion_protection = var.deletion_protection

  # Monitoring
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-postgres"
  })
}

# IAM Role for Enhanced Monitoring
resource "aws_iam_role" "rds_monitoring" {
  name_prefix = "${local.name_prefix}-rds-monitoring-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# Outputs
output "db_instance_id" {
  value = aws_db_instance.main.id
}

output "db_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "db_address" {
  value = aws_db_instance.main.address
}

output "db_port" {
  value = aws_db_instance.main.port
}

output "db_name" {
  value = aws_db_instance.main.db_name
}

output "db_security_group_id" {
  value = aws_security_group.rds.id
}

output "db_credentials_secret_arn" {
  value = aws_secretsmanager_secret.db_credentials.arn
}

output "db_credentials_secret_name" {
  value = aws_secretsmanager_secret.db_credentials.name
}
