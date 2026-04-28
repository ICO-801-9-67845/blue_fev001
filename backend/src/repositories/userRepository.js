import prisma from "../config/prisma.js";

export function createUser(data) {
  return prisma.user.create({
    data,
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export function findUserByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
  });
}

export function findUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
