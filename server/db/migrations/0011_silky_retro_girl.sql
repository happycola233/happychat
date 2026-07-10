ALTER TABLE `messages` ADD `cache_write_tokens` integer;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `cache_write_tokens` integer DEFAULT 0 NOT NULL;