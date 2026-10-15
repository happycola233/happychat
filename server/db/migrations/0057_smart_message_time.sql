-- 随版本升级一次性切换所有已有账号；后续用户自行改选的格式不再覆盖。
UPDATE `user_settings`
SET `ui_prefs` = json_set(COALESCE(`ui_prefs`, '{}'), '$.messageTimeFormat', 'smart');
