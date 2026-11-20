// Delivery workers can write whole snapshots through direct UPDATEs as well as
// the shared upsert. A newer admin revision must survive both kinds of writer.
export const CUSTOMER_REACTION_SETTINGS_GUARD_SQL = `
CREATE OR REPLACE FUNCTION pulcip_order_reaction_settings_guard_trigger()
RETURNS trigger LANGUAGE plpgsql AS $trigger$
DECLARE
  saved_revision numeric := 0;
  incoming_revision numeric := 0;
  settings_fields text[] := ARRAY[
    'reactionDailyLimit', 'reactionCapacity', 'reactionEnabledAt',
    'reactionDisabled', 'reactionDisabledAt', 'reactionFirstDayLimit',
    'reactionLimitUpdates', 'reactionSettingsRevision'
  ];
BEGIN
  IF OLD.payload->>'provider' IS DISTINCT FROM 'community'
    OR NEW.payload->>'provider' IS DISTINCT FROM 'community' THEN RETURN NEW; END IF;
  IF jsonb_typeof(OLD.payload->'reactionSettingsRevision') = 'number' THEN
    saved_revision := (OLD.payload->>'reactionSettingsRevision')::numeric;
  END IF;
  IF jsonb_typeof(NEW.payload->'reactionSettingsRevision') = 'number' THEN
    incoming_revision := (NEW.payload->>'reactionSettingsRevision')::numeric;
  END IF;
  IF saved_revision > incoming_revision THEN
    NEW.payload := (NEW.payload - settings_fields) || COALESCE((
      SELECT jsonb_object_agg(field.key, field.value) FROM jsonb_each(OLD.payload) AS field
      WHERE field.key = ANY(settings_fields)
    ), '{}'::jsonb);
  END IF;
  RETURN NEW;
END;
$trigger$;

DO $install$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'tracked_orders'::regclass AND tgname = 'pulcip_order_reaction_settings_guard') THEN
    CREATE TRIGGER pulcip_order_reaction_settings_guard BEFORE UPDATE OF payload ON tracked_orders
      FOR EACH ROW EXECUTE FUNCTION pulcip_order_reaction_settings_guard_trigger();
  END IF;
END;
$install$;
`;
