ALTER TABLE `usage_logs` ADD `reasoning_effort` text;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `first_token_latency_ms` integer;--> statement-breakpoint
UPDATE `usage_logs`
SET
	`reasoning_effort` = (
		SELECT CASE
			WHEN json_type(`runs`.`request_params`, '$.reasoning_effort') = 'text'
				AND length(json_extract(`runs`.`request_params`, '$.reasoning_effort')) > 0
			THEN json_extract(`runs`.`request_params`, '$.reasoning_effort')
			ELSE NULL
		END
		FROM `runs`
		WHERE `runs`.`id` = `usage_logs`.`run_id`
	),
	`duration_ms` = (
		SELECT CASE
			WHEN `runs`.`started_at` IS NULL OR `runs`.`finished_at` IS NULL THEN NULL
			ELSE max(0, `runs`.`finished_at` - `runs`.`started_at`)
		END
		FROM `runs`
		WHERE `runs`.`id` = `usage_logs`.`run_id`
	),
	`first_token_latency_ms` = (
		SELECT CASE
			WHEN `runs`.`started_at` IS NULL OR min(`run_events`.`created_at`) IS NULL THEN NULL
			ELSE max(0, min(`run_events`.`created_at`) - `runs`.`started_at`)
		END
		FROM `runs`
		LEFT JOIN `run_events`
			ON `run_events`.`run_id` = `runs`.`id`
			AND `run_events`.`type` = 'response.output_text.delta'
		WHERE `runs`.`id` = `usage_logs`.`run_id`
		GROUP BY `runs`.`id`
	)
WHERE `usage_logs`.`run_id` IS NOT NULL;
