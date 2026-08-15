CREATE TABLE `quota_cycles` (
	`user_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`bucket_key` text DEFAULT '' NOT NULL,
	`window_hours` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `rule_id`, `bucket_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `quota_at` integer;--> statement-breakpoint
CREATE INDEX `usage_logs_user_quota_idx` ON `usage_logs` (`user_id`,`quota_at`);
