import prisma from "../config/prisma.js";

export function listMessagesByChatId(chatId) {
  return prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
  });
}

export function createMessage(data) {
  return prisma.message.create({
    data,
  });
}

export function countMessagesByChatId(chatId) {
  return prisma.message.count({
    where: { chatId },
  });
}
