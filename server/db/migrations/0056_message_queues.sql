CREATE TABLE `message_queues` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`items` text NOT NULL,
	`parent_id` text,
	`waiting_run_id` text,
	`sending_id` text,
	`preparing_message_id` text,
	`paused` integer DEFAULT false NOT NULL,
	`error` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`reorder_until` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_queues_user_idx` ON `message_queues` (`user_id`);