CREATE TABLE `model_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_icons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `models` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `models` ADD `group_id` text REFERENCES model_groups(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `models_group_idx` ON `models` (`group_id`);