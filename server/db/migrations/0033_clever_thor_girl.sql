ALTER TABLE `usage_logs` ADD `outcome` text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `terminal_reason` text;--> statement-breakpoint
UPDATE `usage_logs`
SET
  `outcome` = CASE
    WHEN (SELECT `state` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) = 'incomplete'
      AND (SELECT `incomplete_reason` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) = 'content_filter'
      THEN 'failed'
    WHEN (SELECT `state` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) IN ('completed', 'incomplete', 'failed', 'canceled', 'interrupted')
      THEN (SELECT `state` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`)
    WHEN `success` = 0 THEN 'failed'
    ELSE 'completed'
  END,
  `terminal_reason` = CASE
    WHEN (SELECT `state` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) = 'incomplete'
      THEN (SELECT `incomplete_reason` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`)
    WHEN (SELECT `state` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) = 'canceled'
      THEN 'user_cancelled'
    WHEN (SELECT `state` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) = 'interrupted'
      THEN 'server_restart'
    WHEN (SELECT `state` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) = 'failed'
      THEN coalesce(
        CASE WHEN `error_type` IN ('refusal', 'content_filter') THEN `error_type` END,
        CASE
          WHEN (SELECT `error_code` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) IN ('refusal', 'content_filter')
            THEN (SELECT `error_code` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`)
        END,
        (SELECT `error_code` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`),
        `error_type`,
        'error'
      )
    WHEN `success` = 0 THEN coalesce(`error_type`, 'error')
    ELSE NULL
  END,
  `error_type` = CASE
    WHEN (SELECT `state` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) = 'incomplete'
      AND (SELECT `incomplete_reason` FROM `runs` WHERE `runs`.`id` = `usage_logs`.`run_id`) = 'content_filter'
      THEN 'content_filter'
    ELSE `error_type`
  END;--> statement-breakpoint
WITH `responses_history` AS (
  SELECT
    `event`.`run_id` AS `run_id`,
    max(
      CASE
        WHEN `event`.`type` LIKE 'response.refusal.%' THEN 1
        WHEN `event`.`type` = 'response.completed' AND EXISTS (
          SELECT 1
          FROM
            json_each(json_extract(`event`.`data`, '$.response.output')) AS `output_item`,
            json_each(json_extract(`output_item`.`value`, '$.content')) AS `content_part`
          WHERE json_extract(`content_part`.`value`, '$.type') = 'refusal'
        ) THEN 1
        ELSE 0
      END
    ) AS `has_refusal`,
    max(CASE WHEN `event`.`type` = 'response.failed' THEN 1 ELSE 0 END) AS `has_response_failed`,
    max(
      CASE
        WHEN `event`.`type` = 'response.failed'
          THEN json_extract(`event`.`data`, '$.response.error.code')
        ELSE NULL
      END
    ) AS `response_failed_code`
  FROM `run_events` AS `event`
  GROUP BY `event`.`run_id`
)
UPDATE `usage_logs`
SET
  `outcome` = 'failed',
  `terminal_reason` = CASE
    WHEN (
      SELECT `history`.`has_refusal`
      FROM `responses_history` AS `history`
      WHERE `history`.`run_id` = `usage_logs`.`run_id`
    ) = 1 THEN 'refusal'
    ELSE coalesce(
      (
        SELECT `history`.`response_failed_code`
        FROM `responses_history` AS `history`
        WHERE `history`.`run_id` = `usage_logs`.`run_id`
      ),
      `error_type`,
      'response_failed'
    )
  END,
  `error_type` = CASE
    WHEN (
      SELECT `history`.`has_refusal`
      FROM `responses_history` AS `history`
      WHERE `history`.`run_id` = `usage_logs`.`run_id`
    ) = 1 THEN 'refusal'
    ELSE coalesce(
      (
        SELECT `history`.`response_failed_code`
        FROM `responses_history` AS `history`
        WHERE `history`.`run_id` = `usage_logs`.`run_id`
      ),
      `error_type`,
      'response_failed'
    )
  END
WHERE `run_id` IN (
  SELECT `history`.`run_id`
  FROM `responses_history` AS `history`
  WHERE `history`.`has_refusal` = 1 OR `history`.`has_response_failed` = 1
);--> statement-breakpoint
CREATE INDEX `usage_logs_outcome_created_idx` ON `usage_logs` (`outcome`,`created_at`);
