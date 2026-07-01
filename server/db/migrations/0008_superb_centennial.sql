ALTER TABLE `models` ADD `prompt_cache_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `providers` ADD `prompt_cache_retention` text;