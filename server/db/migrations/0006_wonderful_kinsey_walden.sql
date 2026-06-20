CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`sharing_enabled` integer DEFAULT true NOT NULL,
	`title_enabled` integer DEFAULT true NOT NULL,
	`title_model_id` text,
	`title_prompt` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`conversation_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text,
	`snapshot` text NOT NULL,
	`show_avatar` integer DEFAULT true NOT NULL,
	`show_name` integer DEFAULT true NOT NULL,
	`expires_at` integer,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_chats_token_unique` ON `shared_chats` (`token`);--> statement-breakpoint
CREATE INDEX `shared_chats_owner_idx` ON `shared_chats` (`owner_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `can_share` integer;