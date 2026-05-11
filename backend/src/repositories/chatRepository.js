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

export function listRecentChatSummariesByUserId(userId, excludeChatId, take = 2) {
  return prisma.chat.findMany({
    where: {
      userId,
      id: {
        not: excludeChatId,
      },
      summary: {
        not: null,
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      summary: true,
    },
    take,
  });
}
