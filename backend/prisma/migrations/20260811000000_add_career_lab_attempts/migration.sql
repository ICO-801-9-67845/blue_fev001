CREATE TABLE `app_career_lab_attempts` (
  `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL, `labKey` VARCHAR(64) NOT NULL, `labVersion` INTEGER NOT NULL,
  `areaKey` VARCHAR(64) NOT NULL, `state` JSON NOT NULL, `answers` JSON NOT NULL, `skillScores` JSON NOT NULL,
  `reflection` VARCHAR(32) NULL, `status` VARCHAR(32) NOT NULL, `revision` INTEGER NOT NULL DEFAULT 0,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), INDEX `app_career_lab_attempts_userId_updatedAt_idx` (`userId`, `updatedAt`),
  INDEX `app_career_lab_attempts_userId_labKey_idx` (`userId`, `labKey`), INDEX `app_career_lab_attempts_id_userId_revision_idx` (`id`, `userId`, `revision`),
  CONSTRAINT `app_career_lab_attempts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `app_users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
