CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`emoji` text,
	`pinned_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `folders_user_idx` ON `folders` (`user_id`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `folder_id` text REFERENCES folders(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `conversations_folder_idx` ON `conversations` (`folder_id`);