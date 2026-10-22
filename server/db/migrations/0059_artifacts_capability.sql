-- Artifacts 是站内渲染能力：已有文本模型一次性开启，图片模型不适用；管理员之后可逐个关闭，重复执行不会覆盖。
UPDATE `models`
SET `capabilities` = json_set(COALESCE(`capabilities`, '{}'), '$.artifacts', json('true'))
WHERE `kind` IN ('responses', 'chat', 'anthropic')
  AND json_extract(COALESCE(`capabilities`, '{}'), '$.artifacts') IS NULL;
