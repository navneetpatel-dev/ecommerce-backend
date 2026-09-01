# Docker Setup Guide

Docker runs **PostgreSQL** and **Redis** only. The Node.js API runs on the host (`npm run dev`).

The Compose project is named `ecommerce` (not the `backend` folder name), so containers, volumes, and the network are prefixed with `ecommerce`.

## Development Setup

### Prerequisites
- Docker Engine 20.10+
- Docker Compose V2+
- Node.js 20+

### Quick Start

1. **Create `.env` file** (if not exists):
```bash
cp .env.example .env
```

`DB_HOST=localhost` and `REDIS_URL=redis://localhost:6379` should stay as-is so the host-run API can reach the containers.

2. **Start PostgreSQL and Redis**:
```bash
docker compose up -d
```

3. **Run database migrations**:
```bash
npm run db:migrate
```

4. **Seed initial data**:
```bash
npm run db:seed
```

5. **Start the API**:
```bash
npm run dev
```

### What Gets Started

- **PostgreSQL** on `localhost:5432`
  - Database: `ecommerce_dev`
  - User: `postgres`
  - Password: `postgres`
- **Redis** on `localhost:6379`

### Common Commands

```bash
# View logs
docker compose logs -f

# Stop services
docker compose down

# Stop and remove volumes (deletes database data)
docker compose down -v

# Access PostgreSQL
docker compose exec postgres psql -U postgres -d ecommerce_dev

# Access Redis CLI
docker compose exec redis redis-cli

# Run database migrations (on the host)
npm run db:migrate

# Seed database (on the host)
npm run db:seed
```

## Production infrastructure

`docker-compose.prod.yml` also runs PostgreSQL and Redis only. Point a separately deployed API at those hosts.

```bash
docker compose -f docker-compose.prod.yml up -d
npm run db:migrate
```

To build an API image without Compose:

```bash
docker build -t ecommerce-backend:latest .
```

## Troubleshooting

### Port Already in Use

If ports 5432 or 6379 are already in use, change the host mappings in `docker-compose.yml`:

```yaml
services:
  postgres:
    ports:
      - "5433:5432"
```

Then update `DB_PORT` in `.env` to match.

### Database Connection Issues

Check if PostgreSQL is ready:
```bash
docker compose exec postgres pg_isready -U postgres
```

View PostgreSQL logs:
```bash
docker compose logs postgres
```

### Clean Slate (re-seed)

```bash
docker compose down -v
docker compose up -d
npm run db:migrate
npm run db:seed
```

## Data Persistence

Volumes:
- `ecommerce_postgres_data` → PostgreSQL data
- `ecommerce_redis_data` → Redis data

Backup:
```bash
docker compose exec postgres pg_dump -U postgres ecommerce_dev > backup.sql
```

Restore:
```bash
cat backup.sql | docker compose exec -T postgres psql -U postgres ecommerce_dev
```
