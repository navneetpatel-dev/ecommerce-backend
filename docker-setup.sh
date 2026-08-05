#!/bin/bash

echo "🚀 Setting up E-Commerce Backend with Docker..."
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed"
    echo "Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Error: Docker Compose is not installed"
    echo "Please install Docker Compose from https://docs.docker.com/compose/install/"
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "✅ .env file created"
    echo "⚠️  Please update .env with your configuration"
    echo ""
else
    echo "✅ .env file already exists"
fi

# Start Docker containers
echo "🐳 Starting Docker containers..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if services are healthy
if docker-compose ps | grep -q "healthy"; then
    echo "✅ Services are healthy"
else
    echo "⚠️  Services might not be fully ready yet"
fi

echo ""
echo "🗄️  Running database migrations..."
docker-compose exec -T app npm run db:migrate

echo ""
echo "🌱 Seeding database..."
docker-compose exec -T app npm run db:seed

echo ""
echo "✅ Setup complete!"
echo ""
echo "📊 Service URLs:"
echo "   • Application: http://localhost:3000"
echo "   • Health Check: http://localhost:3000/health"
echo ""
echo "📝 Useful commands:"
echo "   • View logs:        docker-compose logs -f"
echo "   • Stop services:    docker-compose down"
echo "   • Restart:          docker-compose restart"
echo "   • App shell:        docker-compose exec app sh"
echo "   • Run migrations:   docker-compose exec app npm run db:migrate"
echo "   • Seed database:    docker-compose exec app npm run db:seed"
echo ""
echo "📖 See DOCKER.md for more information"
