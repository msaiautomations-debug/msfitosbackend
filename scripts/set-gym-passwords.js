/* eslint-disable no-console */
const bcrypt = require("bcrypt");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const prefix = process.env.GYM_PREFIX || "loadtest-";
  const password = process.env.NEW_PASSWORD;

  if (!password) {
    console.error("Set NEW_PASSWORD env var before running this script.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const result = await prisma.gyms.updateMany({
    where: { gym_id: { startsWith: prefix } },
    data: { password_hash: hash, email_verified: true },
  });

  console.log(`Updated ${result.count} gyms with prefix ${prefix}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
