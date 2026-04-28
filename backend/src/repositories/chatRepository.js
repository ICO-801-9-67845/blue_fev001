import prisma from "../config/prisma.js";

export function listChatsByUserId(userId) {
  return prisma.chat.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: { messages: true },
      },
    },
  });
}

export function createChat(data) {
  return prisma.chat.create({
    data,
  });
}

export function findChatById(id) {
  return prisma.chat.findUnique({
    where: { id },
  });
}

export function updateChat(id, data) {
  return prisma.chat.update({
    where: { id },
    data,
  });
}

export function deleteChat(id) {
  return prisma.chat.delete({
    where: { id },
  });
}
