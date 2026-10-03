import { buildApp } from './app.ts';
import { openDb } from './db.ts';
import { seedIfEmpty } from './seed.ts';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('В режиме production необходимо задать переменную окружения JWT_SECRET.');
  process.exit(1);
}

const db = openDb();
await seedIfEmpty(db);

const app = await buildApp({ db, logger: true });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
