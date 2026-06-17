UPDATE models
SET capabilities = json_set(capabilities, '$.vision', json('true'))
WHERE kind = 'image'
  AND model_id LIKE 'gpt-image-%'
  AND json_extract(capabilities, '$.image_generation') = 1;
