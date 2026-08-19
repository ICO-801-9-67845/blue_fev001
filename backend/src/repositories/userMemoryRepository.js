import prisma from "../config/prisma.js";

export function findUserMemoryByUserId(userId) {
  return prisma.userMemory.findUnique({
    where: { userId },
  });
}

export function upsertUserMemory(userId, summary) {
  return prisma.userMemory.upsert({
    where: { userId },
    update: { summary },
    create: {
      userId,
      summary,
    },
  });
}
