ALTER TABLE `models` ADD `pricing` text;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `provider_id` text REFERENCES providers(id);--> statement-breakpoint
CREATE INDEX `usage_logs_created_idx` ON `usage_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `usage_logs_provider_idx` ON `usage_logs` (`provider_id`);--> statement-breakpoint
CREATE INDEX `attachments_user_idx` ON `attachments` (`user_id`);--> statement-breakpoint
CREATE INDEX `error_logs_user_idx` ON `error_logs` (`user_id`);