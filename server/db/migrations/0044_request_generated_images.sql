ALTER TABLE `usage_logs` ADD `generated_image_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- 只读取 run 原始助手消息；分支复制可能保留 run_id，不能沿 messages.run_id 聚合。
UPDATE `usage_logs`
SET `generated_image_count` = (
  SELECT count(DISTINCT json_extract(`image_part`.`value`, '$.attachment_id'))
  FROM `runs`
  INNER JOIN `messages` ON `messages`.`id` = `runs`.`assistant_message_id`
  INNER JOIN json_each(`messages`.`content`) AS `image_part`
  WHERE `runs`.`id` = `usage_logs`.`run_id`
    AND json_extract(`image_part`.`value`, '$.type') = 'image_result'
)
WHERE `usage_logs`.`run_id` IS NOT NULL;
