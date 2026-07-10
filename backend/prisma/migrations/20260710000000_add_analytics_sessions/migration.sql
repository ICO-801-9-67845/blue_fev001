CREATE TABLE `app_analytics_sessions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `endedAt` DATETIME(3) NULL,
  `durationSeconds` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `app_analytics_sessions_userId_startedAt_idx`(`userId`, `startedAt`),
  INDEX `app_analytics_sessions_lastSeenAt_endedAt_idx`(`lastSeenAt`, `endedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `app_analytics_sessions`
  ADD CONSTRAINT `app_analytics_sessions_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `app_users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
