CREATE TABLE `exchange_rates` (
	`id` integer PRIMARY KEY NOT NULL,
	`usd_to_cny` real NOT NULL,
	`fetched_at` integer NOT NULL,
	`legacy_rate` real NOT NULL,
	`legacy_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `cost_cny` real;--> statement-breakpoint
ALTER TABLE `quota_adjustments` ADD `currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `quota_adjustments` ADD `usd_to_cny_rate` real;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `cost_cny` real;