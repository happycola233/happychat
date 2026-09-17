-- 已选择网关超时 504 的旧配置一次性补齐 524；总开关和其他策略参数保持原值。
-- 使用迁移而非读取时补齐，确保管理员之后可单独关闭 524。
UPDATE `app_settings`
SET `upstream_retry` = json_insert(`upstream_retry`, '$.retryStatusCodes[#]', 524)
WHERE EXISTS (
  SELECT 1 FROM json_each(`upstream_retry`, '$.retryStatusCodes') WHERE value = 504
)
AND NOT EXISTS (
  SELECT 1 FROM json_each(`upstream_retry`, '$.retryStatusCodes') WHERE value = 524
);
