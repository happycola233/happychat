CREATE TABLE `quota_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`rule_id` text,
	`bucket_key` text,
	`metric` text NOT NULL,
	`amount` real,
	`effective_from` integer NOT NULL,
	`period_start` integer NOT NULL,
	`expires_at` integer,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quota_adjustments_user_created_idx` ON `quota_adjustments` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `quota_adjustments_user_rule_idx` ON `quota_adjustments` (`user_id`,`rule_id`);--> statement-breakpoint
CREATE TABLE `quota_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`rules` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_quotas` (
	`user_id` text PRIMARY KEY NOT NULL,
	`policy_id` text,
	`overrides` text,
	`enforcement_paused` integer DEFAULT false NOT NULL,
	`paused_at` integer,
	`paused_by` text,
	`note` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_id`) REFERENCES `quota_policies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`paused_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `app_settings` ADD `quota_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `quota_timezone` text DEFAULT 'Asia/Shanghai' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `quota_week_start` text DEFAULT 'mon' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `quota_warn_threshold` real DEFAULT 0.8 NOT NULL;