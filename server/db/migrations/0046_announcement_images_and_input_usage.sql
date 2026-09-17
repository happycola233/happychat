CREATE TABLE `announcement_image_links` (
	`announcement_id` text NOT NULL,
	`image_id` text NOT NULL,
	PRIMARY KEY(`announcement_id`, `image_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `announcement_images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `announcement_image_links_image_idx` ON `announcement_image_links` (`image_id`);--> statement-breakpoint
CREATE TABLE `announcement_images` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `announcement_images_created_idx` ON `announcement_images` (`created_at`);--> statement-breakpoint
ALTER TABLE `messages` ADD `last_input_tokens` integer;