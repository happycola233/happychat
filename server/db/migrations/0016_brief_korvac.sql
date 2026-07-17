CREATE TABLE `model_user_access` (
	`model_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`model_id`, `user_id`),
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `model_user_access_user_idx` ON `model_user_access` (`user_id`,`model_id`);--> statement-breakpoint
ALTER TABLE `models` ADD `access_mode` text DEFAULT 'all' NOT NULL;