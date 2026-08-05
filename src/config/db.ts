import { Sequelize } from 'sequelize';
import { env } from './env';
import { logger } from '@core/logger';

export const sequelize = new Sequelize({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  dialect: 'postgres',
  logging: env.LOG_LEVEL === 'debug' ? (msg) => logger.debug(msg) : false,
  pool: {
    max: 10,
    min: 2,
    acquire: 30000,
    idle: 10000,
  },
});

export async function connectDatabase(retries = 5, delay = 2000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await sequelize.authenticate();
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      logger.warn(`Database connection failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
