DROP INDEX `models_provider_model_unique`;--> statement-breakpoint
ALTER TABLE `models` ADD `description` text;--> statement-breakpoint
ALTER TABLE `models` ADD `tags` text;--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider_id`);