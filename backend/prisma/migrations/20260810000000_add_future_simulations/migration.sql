CREATE TABLE `app_future_simulations` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `selectedProgramId` VARCHAR(255) NOT NULL,
    `selectedOfferId` VARCHAR(191) NOT NULL,
    `selectedCampusId` VARCHAR(191) NOT NULL,
    `startingLevel` VARCHAR(32) NOT NULL,
    `scenarioTrack` VARCHAR(64) NOT NULL,
    `scenarioVersion` INTEGER NOT NULL,
    `setup` JSON NOT NULL,
    `state` JSON NOT NULL,
    `choices` JSON NOT NULL,
    `currentEventId` VARCHAR(96) NULL,
    `stage` VARCHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `app_future_simulations_userId_updatedAt_idx` ON `app_future_simulations`(`userId`, `updatedAt`);
CREATE INDEX `app_future_simulations_id_userId_revision_idx` ON `app_future_simulations`(`id`, `userId`, `revision`);

ALTER TABLE `app_future_simulations` ADD CONSTRAINT `app_future_simulations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `app_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
