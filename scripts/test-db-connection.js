const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const res = await client.query('select now() as now');
    console.log('DB connected:', res.rows[0]);
  } catch (err) {
    console.error('DB connect error:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
