#!/bin/bash

set -euo pipefail

echo "Setting up E-Commerce infrastructure (PostgreSQL + Redis)..."
echo ""

if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed"
    echo "Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi

if docker compose version &> /dev/null; then
    COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE="docker-compose"
else
    echo "Error: Docker Compose is not installed"
    echo "Please install Docker Compose from https://docs.docker.com/compose/install/"
    exit 1
fi

if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo ".env file created"
    echo "Please update .env with your configuration"
    echo ""
else
    echo ".env file already exists"
fi

echo "Starting PostgreSQL and Redis..."
$COMPOSE up -d

echo ""
echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
    if $COMPOSE exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
        echo "PostgreSQL is ready"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "Error: PostgreSQL did not become ready in time"
        exit 1
    fi
    sleep 2
done

echo ""
echo "Running database migrations..."
npm run db:migrate

echo ""
echo "Seeding database..."
npm run db:seed

echo ""
echo "Setup complete!"
echo ""
echo "Infrastructure:"
echo "   • PostgreSQL: localhost:5432 (ecommerce_dev)"
echo "   • Redis:      localhost:6379"
echo ""
echo "Start the API on the host with: npm run dev"
echo ""
echo "Useful commands:"
echo "   • View logs:        docker compose logs -f"
echo "   • Stop services:    docker compose down"
echo "   • Restart:          docker compose restart"
echo "   • Postgres shell:   docker compose exec postgres psql -U postgres -d ecommerce_dev"
echo "   • Redis CLI:        docker compose exec redis redis-cli"
echo "   • Run migrations:   npm run db:migrate"
echo "   • Seed database:    npm run db:seed"
echo ""
echo "See DOCKER.md for more information"
