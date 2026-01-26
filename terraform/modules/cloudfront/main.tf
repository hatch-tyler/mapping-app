# CloudFront Module - CDN for frontend static hosting

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "frontend_bucket_id" {
  type = string
}

variable "frontend_bucket_arn" {
  type = string
}

variable "frontend_bucket_domain_name" {
  type = string
}

variable "api_domain_name" {
  type        = string
  description = "Domain name of the API (ALB DNS name)"
}

variable "domain_name" {
  type        = string
  description = "Custom domain name for CloudFront"
}

variable "certificate_arn" {
  type        = string
  description = "ACM certificate ARN (must be in us-east-1)"
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

# Origin Access Control for S3
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name_prefix}-frontend-oac"
  description                       = "OAC for frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# S3 Bucket Policy for CloudFront access
resource "aws_s3_bucket_policy" "frontend" {
  bucket = var.frontend_bucket_id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${var.frontend_bucket_arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.main.arn
          }
        }
      }
    ]
  })
}

# Cache Policy for static assets
resource "aws_cloudfront_cache_policy" "static_assets" {
  name    = "${local.name_prefix}-static-assets"
  comment = "Cache policy for static frontend assets"

  default_ttl = 86400    # 1 day
  max_ttl     = 31536000 # 1 year
  min_ttl     = 1

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

# Cache Policy for API (no caching)
resource "aws_cloudfront_cache_policy" "api" {
  name    = "${local.name_prefix}-api-no-cache"
  comment = "No caching for API requests"

  default_ttl = 0
  max_ttl     = 0
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "all"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Authorization", "Host", "Accept", "Content-Type"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

# Origin Request Policy for API
resource "aws_cloudfront_origin_request_policy" "api" {
  name    = "${local.name_prefix}-api-origin"
  comment = "Origin request policy for API"

  cookies_config {
    cookie_behavior = "all"
  }
  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["Authorization", "Host", "Accept", "Content-Type", "Origin", "Referer"]
    }
  }
  query_strings_config {
    query_string_behavior = "all"
  }
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name_prefix} distribution"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # US, Canada, Europe
  aliases             = [var.domain_name]

  # S3 Origin for Frontend
  origin {
    domain_name              = var.frontend_bucket_domain_name
    origin_id                = "S3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # ALB Origin for API
  origin {
    domain_name = var.api_domain_name
    origin_id   = "ALB-api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Default behavior - Frontend
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-frontend"

    cache_policy_id = aws_cloudfront_cache_policy.static_assets.id

    viewer_protocol_policy = "redirect-to-https"
    compress               = true
  }

  # API behavior
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ALB-api"

    cache_policy_id          = aws_cloudfront_cache_policy.api.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id

    viewer_protocol_policy = "redirect-to-https"
    compress               = true
  }

  # SPA fallback - return index.html for unmatched routes
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-distribution"
  })
}

# Outputs
output "distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.main.arn
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.main.domain_name
}

output "distribution_hosted_zone_id" {
  value = aws_cloudfront_distribution.main.hosted_zone_id
}
