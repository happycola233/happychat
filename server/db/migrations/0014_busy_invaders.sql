DROP INDEX `attachments_message_idx`;--> statement-breakpoint
CREATE INDEX `attachments_message_created_idx` ON `attachments` (`message_id`,`created_at`,`id`);