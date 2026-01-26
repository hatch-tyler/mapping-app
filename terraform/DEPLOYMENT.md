# AWS Deployment Guide

This guide explains how to deploy the Mapping Application to AWS using Terraform/OpenTofu.

## Architecture Overview

```
                                    ┌─────────────────────────────────────────┐
                                    │              CloudFront                  │
                                    │         (CDN + HTTPS + Caching)          │
                                    └──────────────┬──────────────────────────┘
                                                   │
                      ┌────────────────────────────┴────────────────────────────┐
                      │                                                         │
                      ▼                                                         ▼
         ┌────────────────────┐                                    ┌────────────────────┐
         │    S3 Frontend     │                                    │        ALB         │
         │   (Static Files)   │                                    │   (Load Balancer)  │
         └────────────────────┘                                    └─────────┬──────────┘
                                                                             │
                                              ┌──────────────────────────────┴──────────────────┐
                                              │                       VPC                        │
                                              │  ┌─────────────────────────────────────────┐    │
                                              │  │            Private Subnets               │    │
                                              │  │  ┌─────────────┐    ┌─────────────────┐ │    │
                                              │  │  │  ECS Fargate│    │  RDS PostgreSQL │ │    │
                                              │  │  │  (Backend)  │───▶│   (PostGIS)     │ │    │
                                              │  │  └─────────────┘    └─────────────────┘ │    │
                                              │  └─────────────────────────────────────────┘    │
                                              │                          │                      │
                                              │                          ▼                      │
                                              │                   ┌────────────┐                │
                                              │                   │ S3 Uploads │                │
                                              │                   │   (Files)  │                │
                                              │                   └────────────┘                │
                                              └─────────────────────────────────────────────────┘
```

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **Terraform** >= 1.5.0 or **OpenTofu** >= 1.6.0
3. **AWS CLI** configured with credentials
4. **Domain name** (you'll need to configure DNS)
5. **Docker** for building container images

## Quick Start

### 1. Configure AWS Credentials

```bash
aws configure
# Or export environment variables:
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_DEFAULT_REGION="us-east-1"
```

### 2. Create S3 Bucket for Terraform State (Recommended)

```bash
# Create bucket for state
aws s3 mb s3://your-terraform-state-bucket --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket your-terraform-state-bucket \
  --versioning-configuration Status=Enabled

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Uncomment the backend configuration in `versions.tf` and update bucket name.

### 3. Configure Environment Variables

```bash
cd terraform/environments/prod
cp terraform.tfvars terraform.tfvars.local

# Edit terraform.tfvars.local with your settings:
# - domain_name
# - initial_admin_email
# - route53_zone_id (if using existing zone)
```

### 4. Initialize and Deploy

```bash
cd terraform

# Initialize Terraform
terraform init

# Plan the deployment
terraform plan -var-file=environments/prod/terraform.tfvars

# Apply (review changes carefully)
terraform apply -var-file=environments/prod/terraform.tfvars
```

### 5. Build and Push Docker Image

After Terraform creates the ECR repository:

```bash
# Get ECR login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build the image
cd backend
docker build -f Dockerfile.prod -t mapping-app-backend .

# Tag and push
docker tag mapping-app-backend:latest <ecr-repo-url>:latest
docker push <ecr-repo-url>:latest
```

### 6. Deploy Frontend

```bash
cd frontend

# Build with production API URL
VITE_API_URL=https://api.your-domain.com npm run build

# Upload to S3
aws s3 sync dist/ s3://<frontend-bucket-name>/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/*"
```

### 7. Initialize Database

The first ECS task will run Alembic migrations automatically. Check CloudWatch logs for status.

### 8. Retrieve Admin Password

```bash
# Get the generated admin password
terraform output -raw initial_admin_password
```

## Cost Estimation (Monthly)

| Component | Staging | Production |
|-----------|---------|------------|
| ECS Fargate | ~$10 | ~$40 |
| RDS (t3.micro/small) | ~$15 | ~$30 |
| NAT Gateway | ~$35 | ~$70 |
| ALB | ~$20 | ~$25 |
| S3 | ~$1 | ~$5 |
| CloudFront | ~$1 | ~$5 |
| **Total** | **~$82** | **~$175** |

## Cost Optimization Tips

1. **NAT Gateway**: Consider using NAT instances for staging (~$5/month vs $35)
2. **Reserved Instances**: 1-year RI for RDS saves ~40%
3. **Fargate Spot**: Use for non-critical staging workloads (70% discount)
4. **Single AZ**: Use single AZ for staging (removes 2nd NAT Gateway)

## Security Considerations

1. **Secrets Management**: All secrets stored in AWS Secrets Manager
2. **Encryption**: S3 buckets encrypted at rest (AES-256)
3. **Network**: Private subnets for ECS/RDS, public only for ALB
4. **SSL/TLS**: ACM certificates with TLS 1.3
5. **IAM**: Least-privilege policies for ECS tasks

## Monitoring

### CloudWatch Logs

```bash
# View backend logs
aws logs tail /ecs/mapping-app-prod/backend --follow
```

### CloudWatch Metrics

Key metrics to monitor:
- ECS: CPU/Memory utilization
- RDS: Connections, CPU, Free storage
- ALB: Request count, latency, 5xx errors

### Alarms (Add to Terraform)

```hcl
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "mapping-app-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
```

## Troubleshooting

### ECS Tasks Not Starting

1. Check CloudWatch logs for errors
2. Verify security groups allow traffic
3. Check Secrets Manager permissions
4. Verify ECR image exists

```bash
# Check task status
aws ecs describe-tasks --cluster mapping-app-prod-cluster --tasks <task-arn>
```

### Database Connection Issues

1. Verify security group allows ECS → RDS on port 5432
2. Check Secrets Manager secret contains correct credentials
3. Verify RDS is in the same VPC

### SSL Certificate Issues

1. ACM certificates must be validated (check DNS records)
2. CloudFront requires us-east-1 certificate
3. Allow 10-15 minutes for certificate validation

## CI/CD Integration

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) automates:

1. Running tests
2. Building Docker image
3. Pushing to ECR
4. Updating ECS service
5. Deploying frontend to S3
6. Invalidating CloudFront cache

### Required GitHub Secrets

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

### Required GitHub Variables

- `API_URL` (e.g., `https://api.your-domain.com`)
- `FRONTEND_BUCKET` (S3 bucket name)
- `CLOUDFRONT_DISTRIBUTION_ID`

## Cleanup

To destroy all resources:

```bash
# WARNING: This deletes everything including the database!
terraform destroy -var-file=environments/prod/terraform.tfvars
```

For production, consider:
1. Taking a final RDS snapshot
2. Keeping S3 buckets (add `prevent_destroy` lifecycle)
3. Documenting any manual resources
