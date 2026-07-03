PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_announcement_reads` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer,
	`impressions` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`announcement_id`, `user_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_announcement_reads`("announcement_id", "user_id", "read_at") SELECT "announcement_id", "user_id", "read_at" FROM `announcement_reads`;--> statement-breakpoint
DROP TABLE `announcement_reads`;--> statement-breakpoint
ALTER TABLE `__new_announcement_reads` RENAME TO `announcement_reads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `announcement_reads_user_idx` ON `announcement_reads` (`user_id`);--> statement-breakpoint
ALTER TABLE `announcements` ADD `max_impressions` integer DEFAULT 1 NOT NULL;