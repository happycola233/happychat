-- 仅升级旧的 16k 工厂预设，保留管理员配置的其他预算及高级 max_tokens 覆盖。
UPDATE models
SET default_params = json_set(default_params, '$.max_output_tokens', CASE
  WHEN (model_id = 'claude-opus-4-1' OR model_id GLOB 'claude-opus-4-1-*') OR (model_id = 'claude-opus-4-0' OR model_id GLOB 'claude-opus-4-0-*')
    OR model_id GLOB 'claude-opus-4-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' THEN 32000
  WHEN (model_id = 'claude-opus-4-5' OR model_id GLOB 'claude-opus-4-5-*') OR (model_id = 'claude-sonnet-4-5' OR model_id GLOB 'claude-sonnet-4-5-*')
    OR (model_id = 'claude-haiku-4-5' OR model_id GLOB 'claude-haiku-4-5-*') OR (model_id = 'claude-sonnet-4-0' OR model_id GLOB 'claude-sonnet-4-0-*')
    OR model_id GLOB 'claude-sonnet-4-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    OR (model_id = 'claude-3-7-sonnet' OR model_id GLOB 'claude-3-7-sonnet-*') THEN 64000
  ELSE 128000 END)
WHERE kind = 'anthropic' AND json_extract(default_params, '$.max_output_tokens') = 16000;
--> statement-breakpoint
-- 只升级未定制的基础搜索模板；删除的模板、已配置的限制/域名/版本保持原样。
UPDATE models
SET hard_params = json_set(hard_params, '$.tools', json((
  SELECT json_group_array(json(CASE
    WHEN json_extract(tool.value, '$.type') = 'web_search_20250305'
      AND json_extract(tool.value, '$.name') = 'web_search'
      AND (SELECT count(*) FROM json_each(tool.value)) = 2
    THEN CASE
      WHEN (model_id = 'claude-opus-5' OR model_id GLOB 'claude-opus-5-*') OR (model_id = 'claude-sonnet-5' OR model_id GLOB 'claude-sonnet-5-*')
        OR (model_id = 'claude-fable-5' OR model_id GLOB 'claude-fable-5-*') OR (model_id = 'claude-mythos-5' OR model_id GLOB 'claude-mythos-5-*')
        OR (model_id = 'claude-mythos-preview' OR model_id GLOB 'claude-mythos-preview-*') OR (model_id GLOB 'claude-opus-4-[678]' OR model_id GLOB 'claude-opus-4-[678]-*')
        OR (model_id = 'claude-sonnet-4-6' OR model_id GLOB 'claude-sonnet-4-6-*')
      THEN json_set(tool.value, '$.type', 'web_search_20260318')
      ELSE json_set(tool.value, '$.type', 'web_search_20260318', '$.allowed_callers', json('["direct"]'))
      END
    ELSE tool.value END))
  FROM json_each(hard_params, '$.tools') AS tool
)))
WHERE kind = 'anthropic' AND EXISTS (
  SELECT 1 FROM json_each(hard_params, '$.tools') AS tool
  WHERE json_extract(tool.value, '$.type') = 'web_search_20250305'
    AND json_extract(tool.value, '$.name') = 'web_search'
    AND (SELECT count(*) FROM json_each(tool.value)) = 2
);
--> statement-breakpoint
-- 5.5 不接受 disabled：Opus 移除关闭档，Sonnet 改为独立的工具间思考模式。
UPDATE models
SET allowed_efforts = (
  SELECT json_group_array(json(CASE
    WHEN (CASE WHEN effort.type = 'text' THEN effort.value ELSE json_extract(effort.value, '$.value') END) = 'none'
      THEN '{"value":"between_tools","description":"仅工具间思考"}'
    WHEN effort.type = 'text' THEN json_quote(effort.value)
    ELSE effort.value END))
  FROM json_each(allowed_efforts) AS effort
  WHERE model_id = 'claude-sonnet-5-5' OR model_id GLOB 'claude-sonnet-5-5-*'
    OR (CASE WHEN effort.type = 'text' THEN effort.value ELSE json_extract(effort.value, '$.value') END) <> 'none'
),
capabilities = json_set(capabilities, '$.reasoning', json('true'))
WHERE kind = 'anthropic' AND (
  model_id = 'claude-opus-5-5' OR model_id GLOB 'claude-opus-5-5-*'
  OR model_id = 'claude-sonnet-5-5' OR model_id GLOB 'claude-sonnet-5-5-*'
);
--> statement-breakpoint
UPDATE models
SET default_effort = CASE
  WHEN model_id = 'claude-sonnet-5-5' OR model_id GLOB 'claude-sonnet-5-5-*' THEN 'between_tools'
  ELSE (SELECT CASE WHEN effort.type = 'text' THEN effort.value ELSE json_extract(effort.value, '$.value') END
    FROM json_each(allowed_efforts) AS effort
    ORDER BY (CASE WHEN effort.type = 'text' THEN effort.value ELSE json_extract(effort.value, '$.value') END) = 'medium' DESC,
      effort.key
    LIMIT 1)
  END
WHERE kind = 'anthropic' AND default_effort = 'none' AND (
  model_id = 'claude-opus-5-5' OR model_id GLOB 'claude-opus-5-5-*'
  OR model_id = 'claude-sonnet-5-5' OR model_id GLOB 'claude-sonnet-5-5-*'
);
--> statement-breakpoint
UPDATE models
SET default_params = json_remove(default_params, '$.reasoning_effort')
WHERE kind = 'anthropic' AND json_extract(default_params, '$.reasoning_effort') = 'none' AND (
  model_id = 'claude-opus-5-5' OR model_id GLOB 'claude-opus-5-5-*'
  OR model_id = 'claude-sonnet-5-5' OR model_id GLOB 'claude-sonnet-5-5-*'
);
