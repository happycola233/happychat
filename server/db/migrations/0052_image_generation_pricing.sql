ALTER TABLE `messages` ADD `cost_breakdown` text;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `cost_usd` real;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `cost_breakdown` text;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `image_usage` text;