ALTER TABLE `sessions` ADD `login_ip` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_seen_ip` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_seen_at` integer;