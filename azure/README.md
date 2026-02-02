# Azure Deployment Guide

This directory contains everything needed to deploy the Mapping Application to an Azure Virtual Machine running Docker. The deployment uses Terraform for infrastructure provisioning, Docker Compose for container orchestration, and shell scripts for SSL, backups, and ongoing operations.

## Architecture Overview

```
                    ┌──────────────────────────────────────────────────┐
                    │               Azure VM (Ubuntu 22.04)            │
Internet ──┐       │                                                  │
           │       │  ┌─────────┐    ┌─────────┐    ┌────────────┐   │
    :80/:443 ──────┤► │  nginx  │───►│ backend │───►│ PostgreSQL │   │
           │       │  │ (alpine)│    │(FastAPI)│    │ + PostGIS  │   │
           │       │  └─────────┘    └─────────┘    └────────────┘   │
           │       │       │                              │          │
           │       │  ┌─────────┐         ┌───────────────┘          │
           │       │  │ certbot │         ▼                          │
           │       │  └─────────┘    /mnt/data/ (64GB Premium SSD)   │
           │       │                 ├── postgres/                    │
           │       │                 ├── uploads/                     │
           │       │                 ├── rasters/                     │
           │       │                 ├── certbot/                     │
           │       │                 └── backups/                     │
           │       └──────────────────────────────────────────────────┘
           │
    :22 (SSH) ── restricted by NSG to your IP
```

**Container images are pre-built and hosted on DockerHub:**
- `tjhatch/mapping-app-backend:latest`
- `tjhatch/mapping-app-frontend:latest`

## Directory Structure

```
azure/
├── terraform/
│   ├── main.tf                    # Core infrastructure (VM, networking, disk)
│   ├── variables.tf               # Input variable definitions
│   ├── outputs.tf                 # Post-deploy outputs (IP, passwords, URLs)
│   ├── versions.tf                # Terraform & provider version constraints
│   ├── terraform.tfvars.example   # Template configuration (copy to terraform.tfvars)
│   └── .gitignore                 # Excludes state files and secrets
├── scripts/
│   ├── cloud-init.yml             # VM bootstrap (Docker install, disk mount, configs)
│   ├── deploy.sh                  # Rolling deployment for updates
│   ├── ssl-setup.sh               # Let's Encrypt SSL certificate provisioning
│   ├── backup.sh                  # Database + file backup automation
│   └── restore.sh                 # Restore from backup
├── nginx/
│   ├── nginx-initial.conf         # HTTP-only config (pre-SSL)
│   └── nginx.conf                 # HTTPS config (post-SSL, reference only)
├── docker-compose.prod.yml        # Production container orchestration
└── .env.production.example        # Environment variable template
```

## What Terraform Handles

Running `terraform apply` creates the following **13 Azure resources** automatically:

| Resource | Description |
|----------|-------------|
| Resource Group | `mapping-app-prod-rg` containing all resources |
| Virtual Network | `10.0.0.0/16` address space |
| Subnet | `10.0.1.0/24` for the VM |
| Network Security Group | Firewall rules for SSH (restricted), HTTP, HTTPS |
| Public IP | Static Standard SKU with Azure DNS label |
| Network Interface | Connects VM to subnet and public IP |
| NSG Association | Binds firewall rules to the NIC |
| Managed Data Disk | 64GB Premium SSD for persistent data |
| Data Disk Attachment | Mounts the data disk to the VM at LUN 0 |
| Linux Virtual Machine | Ubuntu 22.04 LTS with SSH key authentication |
| Random Password (DB) | 32-character database password |
| Random Password (Secret Key) | 64-character application secret key |
| Random Password (Admin) | 16-character initial admin password |

Terraform also triggers **cloud-init** on first boot, which:
- Installs Docker CE and Docker Compose plugin
- Detects, formats, and mounts the data disk at `/mnt/data`
- Creates the directory structure (`/mnt/data/postgres`, `uploads`, `rasters`, `certbot`, `backups`)
- Generates the `/opt/mapping-app/.env` file with all credentials
- Writes the initial nginx configuration
- Writes the PostGIS initialization SQL script

## What Must Be Done Manually

After `terraform apply` completes, you need to:

1. **Copy deployment files to the VM** (docker-compose, nginx config, init-db.sql)
2. **Pull Docker images and start services**
3. **Optionally configure SSL** if using a custom domain
4. **Optionally set up automated backups** via cron

These steps are detailed below.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.1.0
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) logged in (`az login`)
- An SSH key pair (`~/.ssh/id_rsa` and `~/.ssh/id_rsa.pub`)
- [Docker](https://docs.docker.com/get-docker/) installed locally (only if rebuilding images)

## Step-by-Step Deployment

### 1. Configure Terraform Variables

```bash
cd azure/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and update at minimum:

```hcl
# Restrict SSH to your public IP (find yours at https://ifconfig.me)
ssh_allowed_cidr = "203.0.113.10/32"

# Your email for Let's Encrypt and admin account
certbot_email       = "you@example.com"
initial_admin_email = "you@example.com"

# Optional: custom domain (leave empty to use Azure DNS label)
domain_name = ""
dns_label   = "gis-mapping-app"   # becomes gis-mapping-app.<region>.cloudapp.azure.com
```

### 2. Provision Azure Infrastructure

```bash
cd azure/terraform

# Initialize providers
terraform init

# Preview what will be created
terraform plan

# Create all resources (type "yes" when prompted)
terraform apply
```

After completion, view the outputs:

```bash
# Show all outputs
terraform output

# Get specific values
terraform output public_ip
terraform output ssh_command
terraform output -raw initial_admin_password
terraform output -raw db_password
```

### 3. Wait for Cloud-Init

Cloud-init runs on the VM's first boot and installs Docker, mounts the data disk, and generates configuration files. Wait for it to finish before proceeding.

```bash
# SSH into the VM
ssh azureuser@$(terraform output -raw public_ip)

# Watch cloud-init progress (wait until "Cloud-init provisioning complete" appears)
tail -f /var/log/cloud-init-output.log

# Or check if cloud-init is done
cloud-init status
```

### 4. Copy Deployment Files to the VM

From your local machine, copy the Docker Compose file to the VM:

```bash
VM_IP=$(cd azure/terraform && terraform output -raw public_ip)

scp azure/docker-compose.prod.yml azureuser@$VM_IP:/opt/mapping-app/docker-compose.prod.yml
```

If cloud-init's config files need correction, you can also push them manually:

```bash
# Nginx config (cloud-init should have already created this)
scp azure/nginx/nginx-initial.conf azureuser@$VM_IP:/opt/mapping-app/nginx/nginx-active.conf
```

### 5. Start the Application

SSH into the VM and start the services:

```bash
ssh azureuser@$VM_IP
cd /opt/mapping-app

# Pull and run the frontend builder to populate the nginx volume
docker compose -f docker-compose.prod.yml --profile build run --rm frontend-builder

# Start all services
docker compose -f docker-compose.prod.yml up -d
```

### 6. Verify the Deployment

```bash
# Check container status (all should show "Up" and healthy)
docker ps

# Test the health endpoint
curl http://localhost/api/health
# Expected: {"status":"healthy"}

# Test from outside the VM (from your local machine)
curl http://$(cd azure/terraform && terraform output -raw fqdn)/api/health
```

The application is now accessible at the URL shown by `terraform output app_url`.

### 7. Set Up SSL (Optional, Requires Custom Domain)

If you have a custom domain with a DNS A record pointing to the VM's IP:

```bash
ssh azureuser@$VM_IP
cd /opt/mapping-app

# Update .env with your domain
sed -i 's/DOMAIN_NAME=.*/DOMAIN_NAME=maps.yourdomain.com/' .env
sed -i 's/URL_SCHEME=.*/URL_SCHEME=https/' .env

# Run the SSL setup script
bash scripts/ssl-setup.sh
```

The script will:
1. Verify DNS resolution
2. Request a Let's Encrypt certificate via the certbot container
3. Generate an SSL-enabled nginx configuration
4. Reload nginx and restart the backend for HTTPS CORS

SSL certificates auto-renew via the certbot container (checks every 12 hours).

> **Note:** SSL is not available with Azure DNS labels (`*.cloudapp.azure.com`). Let's Encrypt does not issue certificates for those domains. You need a custom domain for HTTPS.

### 8. Set Up Automated Backups (Recommended)

```bash
ssh azureuser@$VM_IP

# Copy backup scripts
chmod +x /opt/mapping-app/scripts/*.sh

# Test a manual backup
bash /opt/mapping-app/scripts/backup.sh

# Set up daily backups at 2 AM
crontab -e
# Add this line:
# 0 2 * * * /opt/mapping-app/scripts/backup.sh >> /var/log/mapping-app-backup.log 2>&1
```

Backups are stored at `/mnt/data/backups/` with 30-day retention. For offsite backups to Azure Blob Storage:

```bash
# Add to .env
echo "AZURE_STORAGE_ACCOUNT=yourstorageaccount" >> /opt/mapping-app/.env
echo "AZURE_BACKUP_CONTAINER=backups" >> /opt/mapping-app/.env

# Run with Azure upload
bash /opt/mapping-app/scripts/backup.sh --upload-azure
```

## Common Operations

### Check Service Status

```bash
ssh azureuser@$VM_IP
cd /opt/mapping-app
docker compose -f docker-compose.prod.yml ps
```

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs --tail=100

# Specific service
docker compose -f docker-compose.prod.yml logs --tail=50 backend
docker compose -f docker-compose.prod.yml logs --tail=50 db
docker compose -f docker-compose.prod.yml logs --tail=50 nginx
```

### Restart Services

```bash
# Restart everything
docker compose -f docker-compose.prod.yml restart

# Restart just the backend
docker compose -f docker-compose.prod.yml restart backend
```

### Deploy an Update

When new Docker images are pushed to DockerHub:

```bash
ssh azureuser@$VM_IP
cd /opt/mapping-app

# Pull latest images
docker compose -f docker-compose.prod.yml pull

# Restart with new images
docker compose -f docker-compose.prod.yml up -d

# Rebuild frontend volume with latest frontend image
docker compose -f docker-compose.prod.yml --profile build run --rm frontend-builder

# Restart nginx to pick up new frontend files
docker compose -f docker-compose.prod.yml restart nginx
```

Or use the deploy script if the repo is cloned on the VM:

```bash
bash /opt/mapping-app/scripts/deploy.sh
```

### Restore from Backup

```bash
ssh azureuser@$VM_IP

# List available backups
bash /opt/mapping-app/scripts/restore.sh

# Restore a specific backup (will prompt for confirmation)
bash /opt/mapping-app/scripts/restore.sh 20260202_020000
```

### Tear Down Infrastructure

```bash
cd azure/terraform
terraform destroy
```

This destroys all Azure resources. **The data disk and all data will be permanently deleted.**

## Estimated Monthly Cost

| Resource | SKU | Estimated Cost |
|----------|-----|----------------|
| VM (Standard_B2s) | 2 vCPU, 4 GB RAM | ~$33/month |
| Premium SSD (64 GB) | Data disk | ~$10/month |
| Public IP (Static) | Standard SKU | ~$4/month |
| OS Disk (30 GB) | Premium SSD | ~$5/month |
| **Total** | | **~$52/month** |

## Terraform Variable Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `project_name` | `mapping-app` | Name prefix for all Azure resources |
| `environment` | `prod` | Environment label (prod, staging, dev) |
| `location` | `East US` | Azure region |
| `vm_size` | `Standard_B2s` | VM size (2 vCPU, 4 GB RAM) |
| `admin_username` | `azureuser` | SSH username |
| `ssh_public_key_path` | `~/.ssh/id_rsa.pub` | Path to your SSH public key |
| `ssh_allowed_cidr` | `0.0.0.0/0` | IP range allowed for SSH (restrict this!) |
| `domain_name` | `""` | Custom domain (empty = use Azure DNS label) |
| `dns_label` | `gis` | Azure DNS label prefix |
| `certbot_email` | *(required)* | Email for Let's Encrypt notifications |
| `db_name` | `gis_db` | PostgreSQL database name |
| `db_username` | `gis_user` | PostgreSQL username |
| `data_disk_size_gb` | `64` | Persistent data disk size |
| `upload_max_size_mb` | `500` | Max file upload size |
| `initial_admin_email` | *(required)* | Admin user email for first login |
| `initial_admin_full_name` | `Administrator` | Admin user display name |
| `gunicorn_workers` | `4` | Backend worker processes |

## Recommendations for Future Improvements

### CI/CD Pipeline

The current deployment requires manually building Docker images locally, pushing to DockerHub, and SSHing into the VM to pull them. A CI/CD pipeline (GitHub Actions, Azure DevOps, etc.) would automate this entire flow:

- Build and push Docker images on every merge to `main`
- SSH into the VM (or use a webhook) to trigger `docker compose pull && docker compose up -d`
- Run tests before deploying to catch regressions
- Tag images with git SHA or semantic versions instead of relying on `latest`

### Image Tagging Strategy

All images currently use the `latest` tag. This makes rollbacks impossible since there is no previous version to pull. A better approach:

- Tag images with the git commit SHA: `tjhatch/mapping-app-backend:abc1234`
- Also tag with semantic version: `tjhatch/mapping-app-backend:1.2.0`
- Pin `docker-compose.prod.yml` to a specific tag and update it as part of deployment
- Keep at least 3-5 previous image versions in DockerHub for rollback

### Terraform Remote State

The Terraform state is currently stored locally in `terraform.tfstate`. If the local file is lost or corrupted, Terraform cannot manage the infrastructure. Move to remote state:

```hcl
# In versions.tf, uncomment and configure:
terraform {
  backend "azurerm" {
    resource_group_name  = "terraform-state-rg"
    storage_account_name = "tfstatemappingapp"
    container_name       = "tfstate"
    key                  = "prod.terraform.tfstate"
  }
}
```

This provides state locking (prevents concurrent modifications) and makes collaboration possible.

### Database: Managed Service vs Self-Hosted

PostgreSQL currently runs in a Docker container on the same VM as the application. This is simple but means:

- Database and application compete for the same CPU/RAM
- No automated failover
- Backups are script-based rather than continuous

Consider migrating to **Azure Database for PostgreSQL Flexible Server** with the PostGIS extension. This provides automatic backups, point-in-time restore, high availability options, and independent scaling. The tradeoff is higher cost (~$25-50/month for the smallest tiers).

### Monitoring and Alerting

There is no monitoring beyond Docker health checks. Recommended additions:

- **Azure Monitor agent** on the VM for CPU, memory, and disk metrics
- **Log Analytics workspace** for centralized log collection
- **Alerts** for disk space > 80%, container restarts, health check failures
- **Application-level monitoring**: add a `/api/health/detailed` endpoint that reports database connectivity, disk space, and queue depth
- **Uptime monitoring**: an external service (e.g., Azure Application Insights availability tests) to detect outages

### High Availability

The current setup is a single VM with no redundancy. If the VM goes down, the application is unavailable. Options for improvement:

- **Azure VM Scale Set** with at least 2 instances behind a load balancer
- **Azure Container Apps** or **Azure Kubernetes Service (AKS)** for container orchestration with built-in scaling and self-healing
- **Azure Front Door** or **Application Gateway** for load balancing and WAF protection
- At minimum, enable **Azure VM auto-restart** policies and configure **Azure Backup** for the VM

### Secrets Management

Sensitive values (database password, secret key, admin password) are generated by Terraform and stored in the `.env` file on the VM. Improvements:

- Use **Azure Key Vault** to store secrets and reference them from the application
- Use **Docker secrets** or a secrets manager sidecar instead of environment variables
- Rotate secrets periodically (currently they are set once at provisioning and never rotated)

### Infrastructure Hardening

- **Disable password authentication** (already done -- SSH key only)
- **Enable unattended-upgrades** for automatic OS security patches
- **Set up fail2ban** to block brute-force SSH attempts
- **Restrict egress traffic** via NSG rules (currently only ingress is restricted)
- **Enable Azure Disk Encryption** for the OS and data disks
- **Enable Azure Defender for Servers** for threat detection

### Blue-Green or Canary Deployments

The current deployment strategy is a rolling restart -- containers are stopped and replaced in place. If the new image has a bug, the application is broken until you manually roll back. Consider:

- **Blue-green deployment**: run the new version alongside the old, switch traffic after health check passes
- **Canary deployment**: route a percentage of traffic to the new version and monitor for errors before full rollout
- Docker Compose alone doesn't support these patterns well. Moving to a container orchestrator (AKS, Container Apps) enables them natively.

### Separate Build and Runtime Concerns

The frontend builder currently runs on the production VM to copy static files into a Docker volume. This means the production VM must pull the full frontend image (including all build dependencies) even though it only needs the compiled output. Consider:

- Building the frontend in CI/CD and uploading the `dist/` folder to Azure Blob Storage (served via CDN)
- Or packaging the frontend directly into the nginx image so no builder step is needed at deploy time

### Backup Improvements

- **Test restores regularly** -- backups are useless if restore doesn't work
- **Enable Azure Backup** for VM-level snapshots (provides point-in-time recovery of the entire disk)
- **Encrypt backup files** before uploading to Azure Blob Storage
- **Use Azure Blob Storage lifecycle management** to automatically move old backups to cool/archive tier
- **Monitor backup success/failure** with alerts (the cron job currently only logs to a file)
