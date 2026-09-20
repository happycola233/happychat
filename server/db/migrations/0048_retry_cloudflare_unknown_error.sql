-- 520 表示网关收到异常的源站响应；为已选择网关错误 502 的旧配置一次性补齐。
-- 保留总开关和其余参数；迁移完成后，管理员仍可独立关闭 520。
UPDATE `app_settings`
SET `upstream_retry` = json_insert(`upstream_retry`, '$.retryStatusCodes[#]', 520)
WHERE EXISTS (
  SELECT 1 FROM json_each(`upstream_retry`, '$.retryStatusCodes') WHERE value = 502
)
AND NOT EXISTS (
  SELECT 1 FROM json_each(`upstream_retry`, '$.retryStatusCodes') WHERE value = 520
);
