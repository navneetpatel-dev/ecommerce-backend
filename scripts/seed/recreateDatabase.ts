/**
 * `npm run db:reset`, first step: drops and re-creates the database named by DB_NAME, ending
 * any open connections to it. Destroys everything in it; refuses to run in production.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to drop a database with NODE_ENV=production.');
  const database = process.env.DB_NAME || 'ecommerce_dev';
  if (!/^[a-zA-Z0-9_]+$/.test(database) || database === 'postgres') throw new Error(`Refusing to drop the database "${database}".`);
  const server = new Sequelize('postgres', process.env.DB_USER || 'postgres', process.env.DB_PASSWORD || 'postgres', {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    dialect: 'postgres',
    logging: false,
  });
  try {
    await server.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await server.query(`CREATE DATABASE "${database}"`);
    console.log(`Database ${database} re-created.`);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
