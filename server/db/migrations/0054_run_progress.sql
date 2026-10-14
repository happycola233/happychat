ALTER TABLE `runs` ADD `progress` text;--> statement-breakpoint
CREATE INDEX `runs_state_created_idx` ON `runs` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `error_logs_run_idx` ON `error_logs` (`run_id`);