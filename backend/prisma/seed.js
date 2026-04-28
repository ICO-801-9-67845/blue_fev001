import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_USER_EMAIL || "demo@bluefev.dev";
  const password = process.env.SEED_USER_PASSWORD || "Demo12345";
  const name = process.env.SEED_USER_NAME || "Demo User";

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`Seed skipped. User already exists: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
    },
  });

  console.log(`Seed completed. User created: ${email}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
