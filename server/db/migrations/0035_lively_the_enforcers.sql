PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_announcement_reads` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer NOT NULL,
	PRIMARY KEY(`announcement_id`, `user_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- 旧版未确认曝光行的 read_at 为 NULL；它们不是已读回执，移除次数机制后无需保留。
INSERT INTO `__new_announcement_reads`("announcement_id", "user_id", "read_at")
SELECT "announcement_id", "user_id", "read_at"
FROM `announcement_reads`
WHERE "read_at" IS NOT NULL;--> statement-breakpoint
DROP TABLE `announcement_reads`;--> statement-breakpoint
ALTER TABLE `__new_announcement_reads` RENAME TO `announcement_reads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `announcement_reads_user_idx` ON `announcement_reads` (`user_id`);--> statement-breakpoint
ALTER TABLE `announcements` DROP COLUMN `max_impressions`;
