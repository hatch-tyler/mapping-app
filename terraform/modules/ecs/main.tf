# ECS Module - Fargate cluster for backend API

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "ecs_task_security_group_id" {
  type        = string
  description = "Security group ID for ECS tasks (created externally to avoid circular deps)"
}

variable "target_group_arn" {
  type = string
}

variable "db_credentials_secret_arn" {
  type = string
}

variable "app_secrets_arn" {
  type = string
}

variable "uploads_bucket_name" {
  type = string
}

variable "uploads_access_policy_arn" {
  type = string
}

variable "backend_image" {
  type        = string
  description = "Docker image for backend (e.g., 123456789.dkr.ecr.us-east-1.amazonaws.com/mapping-app:latest)"
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "min_count" {
  type    = number
  default = 1
}

variable "max_count" {
  type    = number
  default = 4
}

variable "upload_max_size_mb" {
  type    = number
  default = 500
}

variable "cors_origins" {
  type        = string
  description = "Comma-separated list of allowed CORS origins"
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

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-cluster"
  })
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.name_prefix}/backend"
  retention_in_days = 30

  tags = local.common_tags
}

# IAM Role for ECS Task Execution
resource "aws_iam_role" "ecs_execution" {
  name_prefix = "${local.name_prefix}-ecs-exec-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name_prefix = "${local.name_prefix}-secrets-"
  role        = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          var.db_credentials_secret_arn,
          var.app_secrets_arn
        ]
      }
    ]
  })
}

# IAM Role for ECS Task (application permissions)
resource "aws_iam_role" "ecs_task" {
  name_prefix = "${local.name_prefix}-ecs-task-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_uploads" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = var.uploads_access_policy_arn
}

# ECS Task Definition
resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.name_prefix}-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "backend"
      image = var.backend_image

      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "ENVIRONMENT"
          value = var.environment
        },
        {
          name  = "CORS_ORIGINS"
          value = var.cors_origins
        },
        {
          name  = "UPLOAD_MAX_SIZE_MB"
          value = tostring(var.upload_max_size_mb)
        },
        {
          name  = "S3_BUCKET"
          value = var.uploads_bucket_name
        },
        {
          name  = "AWS_DEFAULT_REGION"
          value = data.aws_region.current.name
        }
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "${var.db_credentials_secret_arn}:url::"
        },
        {
          name      = "SECRET_KEY"
          valueFrom = "${var.app_secrets_arn}:secret_key::"
        },
        {
          name      = "INITIAL_ADMIN_EMAIL"
          valueFrom = "${var.app_secrets_arn}:initial_admin_email::"
        },
        {
          name      = "INITIAL_ADMIN_PASSWORD"
          valueFrom = "${var.app_secrets_arn}:initial_admin_password::"
        },
        {
          name      = "INITIAL_ADMIN_FULL_NAME"
          valueFrom = "${var.app_secrets_arn}:initial_admin_full_name::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "backend"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8000/api/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = local.common_tags
}

# ECS Service
resource "aws_ecs_service" "backend" {
  name            = "${local.name_prefix}-backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_task_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "backend"
    container_port   = 8000
  }

  deployment_configuration {
    minimum_healthy_percent = 50
    maximum_percent         = 200
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Allow external changes to desired count from auto-scaling
  lifecycle {
    ignore_changes = [desired_count]
  }

  tags = local.common_tags
}

# Auto Scaling
resource "aws_appautoscaling_target" "backend" {
  max_capacity       = var.max_count
  min_capacity       = var.min_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${local.name_prefix}-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "backend_memory" {
  name               = "${local.name_prefix}-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 80
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# Outputs
output "cluster_id" {
  value = aws_ecs_cluster.main.id
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "service_id" {
  value = aws_ecs_service.backend.id
}

output "service_name" {
  value = aws_ecs_service.backend.name
}

output "task_security_group_id" {
  value = var.ecs_task_security_group_id
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.backend.name
}
