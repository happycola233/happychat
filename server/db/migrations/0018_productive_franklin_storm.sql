ALTER TABLE `messages` ADD `reasoning_replay_context` text;--> statement-breakpoint
ALTER TABLE `models` ADD `replay_reasoning` integer DEFAULT false NOT NULL;