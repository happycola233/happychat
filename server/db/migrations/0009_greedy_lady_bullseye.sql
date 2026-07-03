CREATE TABLE `announcement_reads` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer NOT NULL,
	PRIMARY KEY(`announcement_id`, `user_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `announcement_reads_user_idx` ON `announcement_reads` (`user_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`channel` text DEFAULT 'silent' NOT NULL,
	`audience` text DEFAULT 'all' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`publish_at` integer,
	`expires_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `announcements_status_publish_idx` ON `announcements` (`status`,`publish_at`);--> statement-breakpoint
CREATE INDEX `announcements_pinned_idx` ON `announcements` (`pinned`);