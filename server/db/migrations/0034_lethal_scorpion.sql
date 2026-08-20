CREATE TABLE `announcement_user_targets` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`announcement_id`, `user_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `announcement_user_targets_user_idx` ON `announcement_user_targets` (`user_id`,`announcement_id`);--> statement-breakpoint
-- 旧版“仅管理员”公告迁移为升级时管理员账号的精确名单，既不丢失原受众，也不让未来新增管理员误收历史公告。
INSERT INTO `announcement_user_targets` (`announcement_id`, `user_id`)
SELECT `announcements`.`id`, `users`.`id`
FROM `announcements`
CROSS JOIN `users`
WHERE `announcements`.`audience` = 'admins' AND `users`.`role` = 'admin';--> statement-breakpoint
UPDATE `announcements` SET `audience` = 'selected' WHERE `audience` = 'admins';
