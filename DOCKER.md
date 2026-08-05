# Docker Setup Guide

## Development Setup

### Prerequisites
- Docker Engine 20.10+
- Docker Compose V2+

### Quick Start

1. **Create `.env` file** (if not exists):
```bash
cp .env.example .env
# Edit .env with your settings (DB_HOST and REDIS_URL will be overridden by docker-compose)
```

2. **Start all services**:
```bash
docker-compose up
```

Or run in detached mode:
```bash
docker-compose up -d
```

3. **Run database migrations**:
```bash
docker-compose exec app npm run db:migrate
```

4. **Seed initial data**:
```bash
docker-compose exec app npm run db:seed
```

### What Gets Started

- **PostgreSQL** (internal only)
  - Database: `ecommerce_dev`
  - User: `postgres`
  - Password: `postgres`
  - **Note:** Not exposed to host, accessible only within Docker network

- **Redis** (internal only)
  - **Note:** Not exposed to host, accessible only within Docker network

- **Node.js App** on `localhost:3000`
  - Hot reload enabled (changes in `src/` auto-restart)
  - Logs written to `./logs/`
  - Health check: `http://localhost:3000/health`

### Common Commands

```bash
# View logs
docker-compose logs -f

# View app logs only
docker-compose logs -f app

# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes database data)
docker-compose down -v

# Rebuild app container (after package.json changes)
docker-compose build app

# Access app container shell
docker-compose exec app sh

# Access PostgreSQL (from within Docker network)
docker-compose exec postgres psql -U postgres -d ecommerce_dev

# Access Redis CLI (from within Docker network)
docker-compose exec redis redis-cli

# Run database migrations
docker-compose exec app npm run db:migrate

# Seed database
docker-compose exec app npm run db:seed

# Run TypeScript type check
docker-compose exec app npm run typecheck

# Check health
curl http://localhost:3000/health
```

### Hot Reload

The development setup uses volume mounts for:
- `./src` → `/app/src`
- `./database` → `/app/database`

Changes to these directories will trigger automatic restart via `tsx watch`.

**Note:** If you modify `package.json`, rebuild the container:
```bash
docker-compose build app
docker-compose up -d
```

## Production Setup

### Build Production Image

```bash
docker build -t ecommerce-backend:latest .
```

### Run Production Stack

1. **Update `.env` with production values**

2. **Start services**:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

3. **Run migrations**:
```bash
docker-compose -f docker-compose.prod.yml exec app npm run db:migrate
```

### Production Features

- Multi-stage build (smaller image)
- Runs as non-root user
- Health checks enabled
- Only production dependencies
- Optimized for performance

## Troubleshooting

### Port Already in Use

If ports 3000, 5432, or 6379 are already in use, modify `docker-compose.yml`:

```yaml
services:
  app:
    ports:
      - "3001:3000"  # Map to different host port
```

### Database Connection Issues

Check if PostgreSQL is ready:
```bash
docker-compose exec postgres pg_isready -U postgres
```

View PostgreSQL logs:
```bash
docker-compose logs postgres
```

### Hot Reload Not Working

Ensure volumes are mounted correctly:
```bash
docker-compose exec app ls -la /app/src
```

If `node_modules` issues occur, rebuild:
```bash
docker-compose down
docker-compose build --no-cache app
docker-compose up
```

### Clean Slate

Remove everything and start fresh:
```bash
docker-compose down -v
docker-compose build --no-cache
docker-compose up
```

## Environment Variables in Docker

The `docker-compose.yml` overrides these environment variables:
- `DB_HOST=postgres` (service name)
- `REDIS_URL=redis://redis:6379` (service name)

All other variables come from your `.env` file.

## Data Persistence

Volumes are used for data persistence:
- `postgres_data` → PostgreSQL data
- `redis_data` → Redis data
- `./logs` → Application logs

To backup PostgreSQL:
```bash
docker-compose exec postgres pg_dump -U postgres ecommerce_dev > backup.sql
```

To restore:
```bash
cat backup.sql | docker-compose exec -T postgres psql -U postgres ecommerce_dev
```

## Network

All services communicate on the internal Docker network. External ports are exposed only for:
- App: 3000
- PostgreSQL: 5432 (for debugging)
- Redis: 6379 (for debugging)

In production, you might want to remove PostgreSQL and Redis port mappings.
