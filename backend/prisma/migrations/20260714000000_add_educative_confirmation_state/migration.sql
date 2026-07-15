ALTER TABLE app_chats
  ADD COLUMN educativeState JSON NULL,
  ADD COLUMN educativeStateVersion INTEGER NOT NULL DEFAULT 0;

ALTER TABLE app_messages
  ADD COLUMN uiAction JSON NULL;