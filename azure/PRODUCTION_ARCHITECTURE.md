# Production Architecture Recommendations

**Target**: 200 registered users, 50 concurrent sessions
**Application**: Web GIS with PostGIS, vector/raster tile serving, file uploads (up to 500 MB)
**Current setup**: Single Azure Standard_B2s VM (2 burstable vCPU, 4 GB RAM, 64 GB data disk)

---

## Current Bottlenecks

| Component | Current | Problem at 50 Concurrent |
|-----------|---------|--------------------------|
| VM | Standard_B2s (burstable) | CPU throttled after burst credits deplete; 40% baseline means ~0.8 effective vCPU sustained |
| RAM | 4 GB shared across all services | 5 gunicorn workers + PostGIS + nginx compete; PostGIS alone wants 2+ GB for spatial queries |
| Database | PostGIS on same VM, no tuning | Shared CPU/RAM, default postgresql.conf, no connection pooling |
| Workers | 5 gunicorn/uvicorn workers | Over-provisioned for 2 vCPU; context switching hurts more than helps |
| Disk | 64 GB Premium SSD | Adequate for now, but raster uploads could fill this quickly |
| Networking | No CDN, no caching layer | Every static asset request hits nginx on the VM |

---

## Option A: Right-Sized Single VM (Lowest Cost)

**Estimated cost: ~$70-90/month** (vs current ~$35/month)

Keep the single-VM Docker Compose architecture but move to a non-burstable VM with enough headroom.

### VM: Standard_D2s_v5
- 2 vCPU (dedicated, not burstable)
- 8 GB RAM
- ~$70/month (Central US, Linux)

### Changes Required
1. **VM size** → `Standard_D2s_v5` in terraform.tfvars
2. **Data disk** → 128 GB Premium SSD ($19/month) for raster growth room
3. **Gunicorn workers** → 3 (rule of thumb: 2×vCPU - 1 for async workers)
4. **PostgreSQL tuning** (via docker-compose environment or custom postgresql.conf):
   - `shared_buffers = 2GB`
   - `effective_cache_size = 4GB`
   - `work_mem = 64MB`
   - `maintenance_work_mem = 256MB`
   - `max_connections = 100`
5. **Docker resource limits**:
   - db: `mem_limit: 3g`, `cpus: 1.0`
   - backend: `mem_limit: 3g`, `cpus: 1.5`
   - nginx: `mem_limit: 512m`, `cpus: 0.5`
6. **Add Azure CDN** (Standard tier, ~$5/month) for static frontend assets
7. **Nginx tuning**:
   - `worker_connections 1024;`
   - `keepalive_timeout 65;`
   - Add upstream keepalive to backend

### Pros
- Simplest to maintain (same architecture)
- Lowest monthly cost
- No infrastructure changes beyond VM resize

### Cons
- Database and app still compete for resources
- Single point of failure (no redundancy)
- Vertical scaling ceiling around 50-60 concurrent users

### When This Stops Working
If you see sustained CPU above 70% or PostGIS query times exceed 2s during peak usage, move to Option B.

---

## Option B: Separated Database (Recommended)

**Estimated cost: ~$120-160/month**

Move PostGIS to Azure Database for PostgreSQL Flexible Server. This is the highest-impact architectural change for performance and reliability.

### Components

| Service | Spec | Cost/month |
|---------|------|------------|
| App VM | Standard_B2ms (2 vCPU, 8 GB, burstable) | ~$60 |
| Azure DB for PostgreSQL | Burstable B1ms (1 vCPU, 2 GB) + PostGIS | ~$25 |
| Data disk | 128 GB Premium SSD | ~$19 |
| Azure CDN | Standard tier | ~$5 |
| **Total** | | **~$110** |

If you need more DB headroom: General Purpose D2s (2 vCPU, 8 GB) at ~$100/month brings total to ~$185.

### Changes Required
1. **Provision Azure DB for PostgreSQL Flexible Server** (add to terraform)
   - Enable PostGIS extension
   - Enable `pg_trgm` if needed for search
   - Zone-redundant HA optional (~2× DB cost)
2. **Update DATABASE_URL** in docker-compose to point to managed DB
3. **Remove db service** from docker-compose.prod.yml
4. **Remove /mnt/data/postgres** volume mount
5. **Gunicorn workers** → 4 (now the VM doesn't share with PostGIS)
6. **Add PgBouncer** (built into Azure DB Flexible Server) for connection pooling
7. **Backend pool_size** → 20, max_overflow → 30 in database.py

### Pros
- Database gets dedicated compute, automated backups, point-in-time restore
- App VM has full resources for request handling
- Managed patching and failover for database
- Can scale DB and app independently
- Burstable DB tier keeps costs low for moderate usage

### Cons
- Slightly more complex infrastructure
- ~3× current cost
- Network latency between VM and DB (~1ms within same region, negligible)

### When to Upgrade the DB Tier
If query response times exceed 500ms at peak or connection pool saturation occurs, move from Burstable B1ms to General Purpose D2s.

---

## Option C: Container-Based with Azure Container Apps (Most Scalable)

**Estimated cost: ~$150-250/month depending on usage**

Replace the VM entirely with managed containers that auto-scale. Best if you expect growth beyond 200 users.

### Components

| Service | Spec | Cost/month |
|---------|------|------------|
| Azure Container Apps (backend) | 0.5-2 vCPU, 1-4 GB, auto-scale 1-5 replicas | ~$30-80 (usage-based) |
| Azure Container Apps (nginx/frontend) | 0.25 vCPU, 0.5 GB, 1-2 replicas | ~$10-20 |
| Azure DB for PostgreSQL | General Purpose D2s (2 vCPU, 8 GB) | ~$100 |
| Azure Blob Storage | For raster/upload files | ~$5 |
| Azure CDN | Standard tier | ~$5 |
| **Total** | | **~$150-210** |

### Changes Required
1. **Create Container Apps Environment** (terraform)
2. **Create Container App for backend** with:
   - Min replicas: 1, Max replicas: 5
   - Scale rule: HTTP concurrent requests > 20
   - Health probe: /api/health
3. **Create Container App for frontend** (static nginx)
4. **Migrate file storage to Azure Blob Storage** (uploads and rasters)
   - Update file_processor.py to use Azure SDK
   - Update raster tile serving to use Blob-backed paths
5. **Provision Azure DB for PostgreSQL** (same as Option B)
6. **Session affinity**: Enable for WebSocket/long-poll connections if used

### Pros
- Auto-scales to handle traffic spikes (50 → 200 concurrent without intervention)
- Pay-per-use for compute (lower cost during off-hours)
- No VM patching or maintenance
- Built-in ingress with SSL termination (can replace certbot)
- Easy horizontal scaling

### Cons
- Requires code changes for file storage (Blob Storage instead of local disk)
- Cold start latency (~2-5s if scaled to zero)
- More complex infrastructure to set up initially
- Database is the largest fixed cost

---

## Quick Wins (Apply to Any Option)

These improvements cost nothing and should be done regardless of which option you choose:

### 1. Fix Gunicorn Worker Count
```dockerfile
# In Dockerfile.prod, use CPU-appropriate count
--workers ${GUNICORN_WORKERS:-3}
```
Current 5 workers on 2 vCPU causes excessive context switching.

### 2. PostgreSQL Tuning
Add to docker-compose.prod.yml db service (or managed DB parameters):
```yaml
command: >
  postgres
  -c shared_buffers=1GB
  -c effective_cache_size=2GB
  -c work_mem=32MB
  -c maintenance_work_mem=128MB
  -c random_page_cost=1.1
  -c checkpoint_completion_target=0.9
```

### 3. Nginx Connection Tuning
```nginx
worker_processes auto;
worker_connections 1024;

upstream backend {
    server backend:8000;
    keepalive 16;
}
```

### 4. Add Docker Resource Limits
```yaml
# docker-compose.prod.yml
backend:
  deploy:
    resources:
      limits:
        cpus: '1.5'
        memory: 3G

db:
  deploy:
    resources:
      limits:
        cpus: '1.0'
        memory: 3G
```

### 5. Enable Azure CDN for Frontend
Serve static JS/CSS/images from CDN edge nodes instead of the VM. Reduces VM load and improves page load times globally.

### 6. Add Redis for Caching (Optional, ~$15/month)
Cache frequent PostGIS queries (dataset lists, tile metadata) with Azure Cache for Redis (Basic C0). Reduces database load significantly for read-heavy workloads like map tile browsing.

---

## Recommendation Summary

| Scenario | Option | Monthly Cost |
|----------|--------|-------------|
| Budget-conscious, current usage is fine, just need headroom | **A** (right-sized VM) | ~$90 |
| Best balance of cost, performance, and reliability | **B** (separated DB) | ~$130 |
| Expecting growth past 200 users or need auto-scaling | **C** (Container Apps) | ~$180 |

**My recommendation: Start with Option A + Quick Wins.** This gets you from burstable to dedicated CPU, proper tuning, and a CDN — all for ~$55/month more. If you hit the ceiling, Option B (separating the database) is a straightforward next step that doesn't require application code changes.
