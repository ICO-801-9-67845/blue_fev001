ALTER TABLE `app_chats`
  ADD COLUMN `summary` VARCHAR(700) NULL;

CREATE TABLE `app_user_memories` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `summary` VARCHAR(1000) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `app_user_memories_userId_key`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `app_user_memories`
  ADD CONSTRAINT `app_user_memories_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `app_users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
