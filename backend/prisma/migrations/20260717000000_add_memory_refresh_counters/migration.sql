ALTER TABLE `app_chats`
  ADD COLUMN `memoryEligibleTurnCount` INT NOT NULL DEFAULT 0,
  ADD COLUMN `memorySummarizedTurnCount` INT NOT NULL DEFAULT 0;
