CREATE TABLE `model_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`upstream_model_id` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cost_pricing` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `model_routes_model_idx` ON `model_routes` (`model_id`,`sort`);--> statement-breakpoint
CREATE INDEX `model_routes_provider_idx` ON `model_routes` (`provider_id`);--> statement-breakpoint
-- 每个模型原有的唯一供应商成为它的第一条线路；成本价留空表示与用户计价相同，旧账单口径不变。
INSERT INTO `model_routes`("id", "model_id", "provider_id", "upstream_model_id", "priority", "weight", "enabled", "cost_pricing", "sort", "created_at", "updated_at")
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  "id", "provider_id", NULL, 0, 1, 1, NULL, 0, "created_at", "updated_at"
FROM `models`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_models` (
	`usage_notice` text,
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`tags` text,
	`icon` text,
	`group_id` text,
	`kind` text DEFAULT 'responses' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`access_mode` text DEFAULT 'all' NOT NULL,
	`capabilities` text NOT NULL,
	`default_system_prompt` text,
	`default_params` text,
	`hard_params` text,
	`pricing` text,
	`allowed_efforts` text,
	`default_effort` text,
	`replay_reasoning` integer DEFAULT false NOT NULL,
	`default_web_search` integer DEFAULT false NOT NULL,
	`default_x_search` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `model_groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_models`("usage_notice", "id", "model_id", "display_name", "description", "tags", "icon", "group_id", "kind", "enabled", "access_mode", "capabilities", "default_system_prompt", "default_params", "hard_params", "pricing", "allowed_efforts", "default_effort", "replay_reasoning", "default_web_search", "default_x_search", "sort", "created_at", "updated_at") SELECT "usage_notice", "id", "model_id", "display_name", "description", "tags", "icon", "group_id", "kind", "enabled", "access_mode", "capabilities", "default_system_prompt", "default_params", "hard_params", "pricing", "allowed_efforts", "default_effort", "replay_reasoning", "default_web_search", "default_x_search", "sort", "created_at", "updated_at" FROM `models`;--> statement-breakpoint
DROP TABLE `models`;--> statement-breakpoint
ALTER TABLE `__new_models` RENAME TO `models`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `models_group_idx` ON `models` (`group_id`);--> statement-breakpoint
-- drizzle-kit 生成的 ADD COLUMN ... REFERENCES 会丢失 ON DELETE（与 0013/0024 同一个坑），手工补上。
ALTER TABLE `usage_logs` ADD `route_id` text REFERENCES model_routes(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `image_cost_usd` real;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `image_cost_cny` real;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `upstream_cost_usd` real;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `upstream_cost_cny` real;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `upstream_cost_breakdown` text;--> statement-breakpoint
CREATE INDEX `usage_logs_route_created_idx` ON `usage_logs` (`route_id`,`created_at`);--> statement-breakpoint
-- 迁移前模型只有一个供应商：仍能对上「模型 + 当时供应商」的历史日志归入迁移生成的线路。
UPDATE `usage_logs` SET `route_id` = (
  SELECT r.`id` FROM `model_routes` r
  WHERE r.`model_id` = `usage_logs`.`model_id` AND r.`provider_id` = `usage_logs`.`provider_id`
) WHERE `model_id` IS NOT NULL AND `provider_id` IS NOT NULL;--> statement-breakpoint
-- 迁移前只有一套价格，上游成本即计费金额；仍需回算的更早日志保持 NULL，由读取层按价格快照回算。
UPDATE `usage_logs` SET
  `upstream_cost_usd` = `cost_usd`,
  `upstream_cost_cny` = `cost_cny`,
  `upstream_cost_breakdown` = `cost_breakdown`
WHERE `cost_usd` IS NOT NULL;--> statement-breakpoint
-- 生图部分单独成列；人民币金额只在原账单已有完整人民币合计时拆分，否则交由读取层按汇率折算。
UPDATE `usage_logs` SET
  `image_cost_usd` = coalesce(json_extract(`cost_breakdown`, '$.imageUsd'), 0),
  `image_cost_cny` = CASE
    WHEN `cost_cny` IS NULL THEN NULL
    ELSE (
      SELECT coalesce(sum(CASE
        WHEN json_extract(c.value, '$.currency') = 'CNY' THEN json_extract(c.value, '$.amount')
        ELSE json_extract(c.value, '$.amount') * json_extract(`usage_logs`.`cost_breakdown`, '$.exchangeRate.usdToCny')
      END), 0)
      FROM json_each(`usage_logs`.`cost_breakdown`, '$.charges') AS c
      WHERE json_extract(c.value, '$.kind') = 'image'
    )
  END
WHERE `cost_breakdown` IS NOT NULL;
