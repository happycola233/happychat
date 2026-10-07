-- 新版搜索默认直接调用；保留已显式指定的调用方式及其他工具配置。
UPDATE models
SET hard_params = json_set(hard_params, '$.tools', json((
  SELECT json_group_array(json(CASE
    WHEN json_extract(tool.value, '$.type') IN ('web_search_20260209', 'web_search_20260318')
      AND json_extract(tool.value, '$.name') = 'web_search'
      AND json_type(tool.value, '$.allowed_callers') IS NULL
    THEN json_set(tool.value, '$.allowed_callers', json('["direct"]'))
    ELSE tool.value END))
  FROM json_each(hard_params, '$.tools') AS tool
)))
WHERE kind = 'anthropic' AND EXISTS (
  SELECT 1 FROM json_each(hard_params, '$.tools') AS tool
  WHERE json_extract(tool.value, '$.type') IN ('web_search_20260209', 'web_search_20260318')
    AND json_extract(tool.value, '$.name') = 'web_search'
    AND json_type(tool.value, '$.allowed_callers') IS NULL
);
