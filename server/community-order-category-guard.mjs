// A running worker may save a snapshot taken before a category transfer. Enforce
// the saved transfer history at the database boundary, including direct UPDATEs
// and INSERT ... ON CONFLICT writers in other server processes.
export const COMMUNITY_ORDER_CATEGORY_GUARD_SQL = `
CREATE OR REPLACE FUNCTION pulcip_preserve_order_category(saved jsonb, incoming jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
  previous_history jsonb;
  proposed_history jsonb;
  history jsonb;
  result jsonb := incoming;
  transfer jsonb;
  snapshot jsonb;
  metadata jsonb;
  source_id text;
  target_id text;
  primary_id text;
  old_members jsonb;
  old_allocations jsonb;
  origins jsonb;
  stale boolean;
  old_leave_wins boolean;
BEGIN
  IF incoming->>'provider' IS DISTINCT FROM 'community' THEN RETURN incoming; END IF;
  previous_history := CASE WHEN jsonb_typeof(saved->'categoryTransferHistory') = 'array' THEN saved->'categoryTransferHistory' ELSE '[]'::jsonb END;
  proposed_history := CASE WHEN jsonb_typeof(incoming->'categoryTransferHistory') = 'array' THEN incoming->'categoryTransferHistory' ELSE '[]'::jsonb END;
  stale := NOT proposed_history @> previous_history;
  history := CASE WHEN stale THEN previous_history ELSE proposed_history END;
  IF jsonb_array_length(history) = 0 THEN RETURN incoming; END IF;

  SELECT COALESCE(jsonb_object_agg(item->>'discordUserId', item), '{}'::jsonb) INTO old_members
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(saved->'communityResults') = 'array' THEN saved->'communityResults' ELSE '[]'::jsonb END) AS entries(item)
    WHERE jsonb_typeof(item) = 'object' AND item->>'discordUserId' IS NOT NULL;

  FOR transfer IN SELECT value FROM jsonb_array_elements(history) LOOP
    source_id := transfer->>'fromCategoryId';
    target_id := transfer->>'toCategoryId';
    IF source_id IS NULL OR target_id IS NULL OR source_id = target_id THEN CONTINUE; END IF;
    primary_id := COALESCE(NULLIF(result->>'categoryId', ''), NULLIF(result->>'stockType', ''), CASE WHEN result->>'service' = 'COMMUNITY-ONLINE' THEN 'online' ELSE 'offline' END);
    origins := CASE WHEN jsonb_typeof(transfer->'allocationOrigins') = 'array' THEN transfer->'allocationOrigins' ELSE '[]'::jsonb END;
    -- Reattach the purchased portion before translating an old worker's category.
    -- The array order is retained by delivery/extension writers; member IDs also
    -- cover workers which already adopted the new category mid-delivery.
    IF jsonb_array_length(origins) > 0 THEN
      IF jsonb_typeof(result->'categoryAllocations') = 'array' THEN
        result := jsonb_set(result, '{categoryAllocations}', COALESCE((SELECT jsonb_agg(
          CASE WHEN NOT item ? 'allocationId' AND origins->((position - 1)::integer)->>'allocationId' IS NOT NULL
            THEN item || jsonb_build_object('allocationId', origins->((position - 1)::integer)->>'allocationId') ELSE item END ORDER BY position)
          FROM jsonb_array_elements(result->'categoryAllocations') WITH ORDINALITY AS entries(item, position)), '[]'::jsonb));
      END IF;
      IF jsonb_typeof(result->'communityResults') = 'array' THEN
        result := jsonb_set(result, '{communityResults}', COALESCE((SELECT jsonb_agg(
          CASE WHEN jsonb_typeof(item) = 'object' AND NOT item ? 'allocationId' AND identity.allocation_id IS NOT NULL
            THEN item || jsonb_build_object('allocationId', identity.allocation_id) ELSE item END ORDER BY position)
          FROM jsonb_array_elements(result->'communityResults') WITH ORDINALITY AS entries(item, position)
          CROSS JOIN LATERAL (SELECT COALESCE(
              old_members->(item->>'discordUserId')->>'allocationId',
              (SELECT min(origin->>'allocationId') FROM jsonb_array_elements(origins) AS entries(origin)
                WHERE origin->>'categoryId' = COALESCE(NULLIF(item->>'categoryId', ''), primary_id)
                HAVING count(*) = 1)
            ) AS allocation_id) AS identity), '[]'::jsonb));
      END IF;
    END IF;
    SELECT value INTO snapshot FROM jsonb_array_elements(CASE WHEN jsonb_typeof(saved->'categoryAllocations') = 'array' THEN saved->'categoryAllocations' ELSE '[]'::jsonb END)
      WHERE value->>'categoryId' = target_id LIMIT 1;
    metadata := jsonb_strip_nulls(jsonb_build_object(
      'categoryId', target_id,
      'categoryName', COALESCE(transfer->>'toCategoryName', snapshot->>'categoryName', target_id),
      'colorKey', COALESCE(transfer->'toColorKey', snapshot->'colorKey', saved->'categoryColorKey'),
      'checkReplacementEnabled', COALESCE(transfer->'toCheckReplacementEnabled', snapshot->'checkReplacementEnabled', saved->'categoryCheckReplacementEnabled'),
      'reactionUseEnabled', COALESCE(transfer->'toReactionUseEnabled', snapshot->'reactionUseEnabled', saved->'categoryReactionUseEnabled')
    ));
    IF primary_id = source_id THEN
      result := result || jsonb_build_object('categoryId', target_id, 'stockType', target_id,
        'categoryName', CASE WHEN jsonb_typeof(result->'categoryAllocations') = 'array' AND jsonb_array_length(result->'categoryAllocations') > 1
          THEN jsonb_array_length(result->'categoryAllocations')::text || ' categories' ELSE metadata->>'categoryName' END);
      IF metadata ? 'colorKey' THEN result := jsonb_set(result, '{categoryColorKey}', metadata->'colorKey'); END IF;
      IF metadata ? 'checkReplacementEnabled' THEN result := jsonb_set(result, '{categoryCheckReplacementEnabled}', metadata->'checkReplacementEnabled'); END IF;
      IF metadata ? 'reactionUseEnabled' THEN result := jsonb_set(result, '{categoryReactionUseEnabled}', metadata->'reactionUseEnabled'); END IF;
    ELSIF result->>'stockType' = source_id THEN
      result := jsonb_set(result, '{stockType}', to_jsonb(target_id));
    END IF;
    IF jsonb_typeof(result->'categoryAllocations') = 'array' THEN
      result := jsonb_set(result, '{categoryAllocations}', COALESCE((SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(item) = 'object' AND item->>'categoryId' = source_id THEN item || metadata ELSE item END ORDER BY position)
        FROM jsonb_array_elements(result->'categoryAllocations') WITH ORDINALITY AS entries(item, position)), '[]'::jsonb));
    END IF;
    IF jsonb_typeof(result->'communityResults') = 'array' THEN
      result := jsonb_set(result, '{communityResults}', COALESCE((SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(item) = 'object' AND COALESCE(NULLIF(item->>'categoryId', ''), primary_id) = source_id
          THEN item || (metadata - 'checkReplacementEnabled') ELSE item END ORDER BY position)
        FROM jsonb_array_elements(result->'communityResults') WITH ORDINALITY AS entries(item, position)), '[]'::jsonb));
    END IF;
  END LOOP;
  result := jsonb_set(result, '{categoryTransferHistory}', history);
  IF jsonb_typeof(result->'categoryAllocations') = 'array' AND jsonb_array_length(result->'categoryAllocations') > 0 THEN
    result := jsonb_set(result, '{categoryName}', (SELECT to_jsonb(CASE WHEN count(DISTINCT item->>'categoryId') > 1
      THEN count(DISTINCT item->>'categoryId')::text || ' categories' ELSE min(COALESCE(item->>'categoryName', item->>'categoryId')) END)
      FROM jsonb_array_elements(result->'categoryAllocations') AS allocations(item)));
  END IF;

  IF stale THEN
    -- Support extensions and one-use leave claims made after the old worker's
    -- snapshot must survive. Actual delivery/status progress still comes in.
    result := (result - ARRAY['expiredAt', 'durationMonths', 'categoryIsPeriodic']) || COALESCE((
      SELECT jsonb_object_agg(field.key, field.value) FROM jsonb_each(saved) AS field
      WHERE field.key IN ('expiredAt', 'durationMonths', 'categoryIsPeriodic')
    ), '{}'::jsonb);
    result := result || COALESCE((SELECT jsonb_object_agg(field.key, field.value) FROM jsonb_each(saved) AS field
      WHERE field.key IN ('membersLeftAt', 'membersLeaveAllRequestedAt', 'publicLeaveAllRequestedAt') AND field.value <> 'null'::jsonb), '{}'::jsonb);
    old_leave_wins := COALESCE(result->'autoLeaveJob'->'processed', '0'::jsonb) <= COALESCE(saved->'autoLeaveJob'->'processed', '0'::jsonb)
      OR result->'autoLeaveJob'->>'id' IS DISTINCT FROM saved->'autoLeaveJob'->>'id';
    IF jsonb_typeof(saved->'autoLeaveJob') = 'object' AND (old_leave_wins
      OR (saved->'autoLeaveJob'->>'status' <> 'running' AND result->'autoLeaveJob'->>'status' = 'running')) THEN
      result := jsonb_set(result, '{autoLeaveJob}', saved->'autoLeaveJob');
    END IF;

    SELECT COALESCE(jsonb_object_agg(COALESCE(item->>'allocationId', item->>'categoryId'), item), '{}'::jsonb) INTO old_allocations
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(saved->'categoryAllocations') = 'array' THEN saved->'categoryAllocations' ELSE '[]'::jsonb END) AS entries(item)
      WHERE jsonb_typeof(item) = 'object' AND item->>'categoryId' IS NOT NULL;
    IF jsonb_typeof(result->'categoryAllocations') = 'array' THEN
      result := jsonb_set(result, '{categoryAllocations}', COALESCE((SELECT jsonb_agg(
        CASE WHEN old_allocations ? COALESCE(item->>'allocationId', item->>'categoryId') THEN (item - ARRAY['expiredAt', 'durationMonths', 'isPeriodic']) || COALESCE((
          SELECT jsonb_object_agg(field.key, field.value) FROM jsonb_each(old_allocations->COALESCE(item->>'allocationId', item->>'categoryId')) AS field
          WHERE field.key IN ('expiredAt', 'durationMonths', 'isPeriodic')
        ), '{}'::jsonb) ELSE item END ORDER BY position)
        FROM jsonb_array_elements(result->'categoryAllocations') WITH ORDINALITY AS entries(item, position)), '[]'::jsonb));
    END IF;

    SELECT COALESCE(jsonb_object_agg(item->>'discordUserId', item), '{}'::jsonb) INTO old_members
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(saved->'communityResults') = 'array' THEN saved->'communityResults' ELSE '[]'::jsonb END) AS entries(item)
      WHERE jsonb_typeof(item) = 'object' AND item->>'discordUserId' IS NOT NULL;
    IF jsonb_typeof(result->'communityResults') = 'array' THEN
      result := jsonb_set(result, '{communityResults}', COALESCE((SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(item) = 'object' AND old_members ? (item->>'discordUserId') THEN
          CASE WHEN old_leave_wins OR (old_members->(item->>'discordUserId')->>'autoLeaveCompletedAt' IS NOT NULL
            AND COALESCE(item->>'autoLeaveCompletedAt', '') <= old_members->(item->>'discordUserId')->>'autoLeaveCompletedAt') THEN
            item || COALESCE((SELECT jsonb_object_agg(field.key, field.value) FROM jsonb_each(old_members->(item->>'discordUserId')) AS field
              WHERE field.key LIKE 'autoLeave%' OR field.key = 'leftServerAt'
                OR (old_members->(item->>'discordUserId')->>'leftServerAt' IS NOT NULL AND field.key IN ('membershipStatus', 'membershipDetails', 'membershipCheckedAt'))), '{}'::jsonb)
          ELSE item END
        ELSE item END ORDER BY position)
        FROM jsonb_array_elements(result->'communityResults') WITH ORDINALITY AS entries(item, position)), '[]'::jsonb));
    END IF;
    IF jsonb_typeof(result->'categoryAllocations') = 'array' AND jsonb_typeof(result->'communityResults') = 'array' THEN
      result := jsonb_set(result, '{categoryAllocations}', COALESCE((SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(allocation) = 'object' AND allocation ? 'added' THEN allocation || jsonb_build_object('added', (
          SELECT count(*) FROM jsonb_array_elements(result->'communityResults') AS members(member)
          WHERE (CASE WHEN allocation ? 'allocationId' THEN member->>'allocationId' = allocation->>'allocationId'
            ELSE member->>'categoryId' = allocation->>'categoryId' END) AND lower(member->>'state') = 'joined'
        )) ELSE allocation END ORDER BY position)
        FROM jsonb_array_elements(result->'categoryAllocations') WITH ORDINALITY AS allocations(allocation, position)), '[]'::jsonb));
    END IF;
  END IF;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION pulcip_order_category_guard_trigger()
RETURNS trigger LANGUAGE plpgsql AS $trigger$
BEGIN
  NEW.payload := pulcip_preserve_order_category(OLD.payload, NEW.payload);
  RETURN NEW;
END;
$trigger$;

DO $install$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'tracked_orders'::regclass AND tgname = 'pulcip_order_category_guard') THEN
    CREATE TRIGGER pulcip_order_category_guard BEFORE UPDATE OF payload ON tracked_orders
      FOR EACH ROW EXECUTE FUNCTION pulcip_order_category_guard_trigger();
  END IF;
END;
$install$;
`;
