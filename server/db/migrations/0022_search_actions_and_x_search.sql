ALTER TABLE `messages` RENAME COLUMN `web_search_actions` TO `search_actions`;--> statement-breakpoint
ALTER TABLE `models` ADD `default_x_search` integer DEFAULT false NOT NULL;
