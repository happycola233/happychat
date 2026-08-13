ALTER TABLE `usage_logs` ADD `pricing_snapshot` text;--> statement-breakpoint
UPDATE `usage_logs`
SET `pricing_snapshot` = (
	SELECT `models`.`pricing`
	FROM `models`
	WHERE `models`.`id` = `usage_logs`.`model_id`
)
WHERE `pricing_snapshot` IS NULL;
