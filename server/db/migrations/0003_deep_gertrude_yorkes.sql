ALTER TABLE `conversations` ADD `pinned_at` integer;--> statement-breakpoint
CREATE INDEX `conversations_user_pinned_idx` ON `conversations` (`user_id`,`pinned_at`);