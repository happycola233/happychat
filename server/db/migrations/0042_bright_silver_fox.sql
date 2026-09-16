ALTER TABLE `app_settings` ADD `quota_warning_message` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `context_optimization_suggestion` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `upstream_retry` text;--> statement-breakpoint
ALTER TABLE `models` ADD `usage_notice` text;--> statement-breakpoint
ALTER TABLE `providers` ADD `extra_headers` text DEFAULT '{}' NOT NULL;