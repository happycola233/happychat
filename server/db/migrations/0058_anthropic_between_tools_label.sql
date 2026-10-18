-- between_tools 是 Sonnet 5.5 的关闭档：只改写仍为旧出厂文案的选项，保留管理员自定义描述。
UPDATE models
SET allowed_efforts = (
  SELECT json_group_array(json(CASE
    WHEN effort.type = 'object'
      AND json_extract(effort.value, '$.value') = 'between_tools'
      AND json_extract(effort.value, '$.description') = '仅工具间思考'
      THEN json_set(effort.value, '$.description', '关闭')
    WHEN effort.type = 'text' THEN json_quote(effort.value)
    ELSE effort.value END))
  FROM json_each(allowed_efforts) AS effort
)
WHERE kind = 'anthropic' AND EXISTS (
  SELECT 1 FROM json_each(allowed_efforts) AS effort
  WHERE effort.type = 'object'
    AND json_extract(effort.value, '$.value') = 'between_tools'
    AND json_extract(effort.value, '$.description') = '仅工具间思考'
);
