ALTER TABLE `app_settings` ADD `show_cost` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `cost_usd` real;
