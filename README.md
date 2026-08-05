# E-Commerce Backend

Multi-vendor e-commerce platform backend built with Node.js, Express, TypeScript 7, PostgreSQL, and Redis.

## Features

- 🏪 Multi-vendor marketplace
- 👥 Role-based access control (Admin, Vendor, Customer)
- 🛒 Shopping cart with Redis persistence
- 💳 Payment integration (Razorpay)
- 📦 Order management with vendor splitting
- 🎟️ Advanced coupon engine
- 📧 Email notifications (AWS SES)
- 🔍 Full-text search (PostgreSQL)
- 📊 Vendor dashboard & analytics
- 🪙 Commission & payout management
- ⭐ Product reviews & ratings
- 💝 Wishlist functionality
- 📝 Audit trails & soft delete
- 🔐 JWT authentication with refresh tokens

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript 7.0 (Go-based compiler)
- **Framework:** Express.js
- **Database:** PostgreSQL 16
- **Cache/Queue:** Redis 7
- **ORM:** Sequelize with CLI migrations
- **Validation:** Zod
- **Authentication:** JWT + bcrypt
- **File Storage:** AWS S3
- **Payment:** Razorpay
- **Email:** AWS SES
- **Logging:** Winston with daily rotation

## Quick Start (Docker) 🐳

**Recommended for quick setup!**

1. **Prerequisites**: Docker & Docker Compose

2. **Run setup script**:
```bash
./docker-setup.sh
```

That's it! The script will:
- Create `.env` from template
- Start PostgreSQL, Redis, and the app
- Run migrations
- Seed initial data

**Manual Docker setup:**
```bash
# Create .env
cp .env.example .env

# Start services
docker-compose up -d

# Run migrations
docker-compose exec app npm run db:migrate

# Seed data
docker-compose exec app npm run db:seed
```

Access the API at `http://localhost:3000`

See [DOCKER.md](DOCKER.md) for detailed Docker documentation.

## Local Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis 7+

### Installation

1. **Clone and install**:
```bash
npm install
```

2. **Configure environment**:
```bash
cp .env.example .env
# Edit .env with your settings
```

3. **Setup database**:
```bash
# Create database
createdb ecommerce_dev

# Run migrations
npm run db:migrate

# Seed initial data
npm run db:seed
```

4. **Start Redis**:
```bash
# macOS
brew services start redis

# Linux
sudo systemctl start redis
```

5. **Start development server**:
```bash
npm run dev
```

## Available Scripts

### Development
```bash
npm run dev              # Start dev server with hot reload
npm run typecheck        # Type check without building
npm run lint            # Run ESLint
```

### Production
```bash
npm run build           # Build TypeScript to dist/
npm start              # Run production server
```

### Database
```bash
npm run db:migrate      # Run migrations
npm run db:seed        # Seed initial data
```

### Docker
```bash
npm run docker:dev          # Start dev environment
npm run docker:dev:build    # Rebuild and start dev
npm run docker:dev:down     # Stop dev environment

npm run docker:prod         # Start production environment
npm run docker:prod:build   # Rebuild and start production
npm run docker:prod:down    # Stop production environment
```

### Testing
```bash
npm test               # Run tests
```

## Project Structure

```
ecommerce/
├── src/
│   ├── config/           # Configuration files
│   ├── core/             # Core utilities (logger, errors, etc.)
│   ├── middleware/       # Express middleware
│   ├── modules/          # Business modules
│   │   ├── auth/         # Authentication
│   │   ├── users/        # User management
│   │   ├── vendors/      # Vendor management
│   │   ├── products/     # Product catalog
│   │   ├── cart/         # Shopping cart
│   │   ├── orders/       # Order processing
│   │   ├── checkout/     # Checkout flow
│   │   ├── reviews/      # Product reviews
│   │   ├── wishlist/     # User wishlists
│   │   └── ...
│   ├── routes/           # Route definitions
│   ├── app.ts           # Express app setup
│   └── server.ts        # Entry point
├── database/
│   ├── models/          # Sequelize models
│   ├── migrations/      # Schema migrations
│   └── seeders/         # Initial data
├── logs/                # Log files (auto-created)
├── dist/                # Compiled output
├── docker-compose.yml   # Docker dev setup
├── Dockerfile           # Production image
└── Dockerfile.dev       # Development image
```

## Environment Variables

Key environment variables (see `.env.example` for full list):

```bash
# Server
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_NAME=ecommerce_dev
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# AWS (optional for full features)
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
S3_BUCKET=your-bucket

# Razorpay (optional for payments)
RAZORPAY_KEY_ID=your-key
RAZORPAY_KEY_SECRET=your-secret
```

## API Documentation

Base URL: `http://localhost:3000/api/v1`

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - Logout

### Products
- `GET /products` - List products
- `GET /products/:id` - Get product details
- `POST /products` - Create product (Vendor)
- `PUT /products/:id` - Update product (Vendor)

### Cart
- `GET /cart` - Get user's cart
- `POST /cart` - Add item to cart
- `PUT /cart/:itemId` - Update cart item
- `DELETE /cart/:itemId` - Remove from cart

### Orders
- `POST /checkout` - Create order from cart
- `GET /orders` - List user orders
- `GET /orders/:id` - Get order details
- `POST /orders/:id/cancel` - Cancel order

See the source code for complete API endpoints.

## Default Credentials

After seeding, you can login with:

- **Admin**: admin@ecommerce.com / Admin@123
- **Vendor**: (created via registration)
- **Customer**: (created via registration)

## Development

### Hot Reload

Changes to TypeScript files automatically restart the server via `ts-node-dev`.

### Type Checking

```bash
npm run typecheck
```

The project uses TypeScript 7.0 with the Go-based compiler for faster type checking.

### Database Changes

1. Create migration:
```bash
npx sequelize-cli migration:generate --name your-migration-name
```

2. Edit the migration file in `database/migrations/`

3. Run migration:
```bash
npm run db:migrate
```

## Production Deployment

1. **Build Docker image**:
```bash
docker build -t ecommerce-backend:latest .
```

2. **Run with production compose**:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

Or deploy to your container orchestration platform (Kubernetes, ECS, etc.)

## Troubleshooting

**Port already in use:**
- Change `PORT` in `.env`

**Database connection failed:**
- Ensure PostgreSQL is running
- Check credentials in `.env`

**Redis connection failed:**
- Ensure Redis is running
- Check `REDIS_URL` in `.env`

**TypeScript errors:**
- Run `npm run typecheck`
- Ensure TypeScript 7.0.2+ is installed: `npx tsc --version`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Run linter: `npm run lint`
6. Submit a pull request

## License

MIT

## Support

For issues and questions, please open a GitHub issue.
