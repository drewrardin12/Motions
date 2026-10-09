-- Preserves existing routines and numeric completion identifiers.
-- The checked RPCs keep the original household membership checks and prevent stale library replacement.
begin;

alter table public.household_motions add column if not exists task_ids jsonb;
update public.household_motions m
set task_ids = coalesce((select jsonb_agg((n - 1)::text order by n) from jsonb_array_elements(m.tasks) with ordinality as t(value,n)), '[]'::jsonb)
where task_ids is null;

create or replace function public.get_household_motions()
returns jsonb language sql security definer set search_path = public
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', motion_id, 'title', title, 'label', label, 'time', time_text,
    'image', image_url, 'accent', accent, 'message', completion_message,
    'tasks', tasks, 'taskIds', task_ids
  ) order by position), '[]'::jsonb)
  from public.household_motions
  where household_id = (select household_id from public.household_devices where user_id = auth.uid() limit 1);
$function$;

create or replace function public.save_household_motions(p_member_id uuid, p_motions jsonb)
returns boolean language plpgsql security definer set search_path = public
as $function$
declare hid uuid; item jsonb;
begin
  select m.household_id into hid from public.household_members m
  join public.household_devices d on d.household_id = m.household_id
  where m.id = p_member_id and d.user_id = auth.uid() limit 1;
  if hid is null then raise exception 'Member is not part of this household'; end if;
  if jsonb_typeof(p_motions) is distinct from 'array' then raise exception 'Motions must be an array'; end if;
  for item in select value from jsonb_array_elements(p_motions) loop
    if jsonb_typeof(item->'tasks') is distinct from 'array'
       or jsonb_typeof(item->'taskIds') is distinct from 'array'
       or jsonb_array_length(item->'tasks') <> jsonb_array_length(item->'taskIds') then
      raise exception 'Refresh MOTIONS before editing checklist steps';
    end if;
    if exists (select 1 from jsonb_array_elements(item->'taskIds') t where jsonb_typeof(t) <> 'string' or t #>> '{}' = '')
       or (select count(*) from jsonb_array_elements(item->'taskIds')) <> (select count(distinct t) from jsonb_array_elements(item->'taskIds') t) then
      raise exception 'Checklist step IDs must be unique, nonempty strings';
    end if;
  end loop;
  delete from public.household_motions where household_id = hid;
  insert into public.household_motions (
    household_id,motion_id,title,label,time_text,image_url,accent,completion_message,tasks,task_ids,position,updated_by
  ) select hid, item.value->>'id', item.value->>'title', coalesce(item.value->>'label',''),
    coalesce(item.value->>'time',''), coalesce(item.value->>'image',''), coalesce(item.value->>'accent','#d6a443'),
    coalesce(item.value->>'message','Motion complete.'), item.value->'tasks', item.value->'taskIds', item.ordinality::integer-1,p_member_id
  from jsonb_array_elements(p_motions) with ordinality as item(value,ordinality);
  return true;
end;
$function$;

create or replace function public.save_household_motions_checked(p_member_id uuid, p_motions jsonb, p_expected jsonb)
returns boolean language plpgsql security definer set search_path = public
as $function$
declare hid uuid;
begin
  select m.household_id into hid from public.household_members m
  join public.household_devices d on d.household_id = m.household_id
  where m.id = p_member_id and d.user_id = auth.uid() limit 1;
  if hid is null then raise exception 'Member is not part of this household'; end if;
  perform pg_advisory_xact_lock(hashtextextended(hid::text || ':motions',0));
  if public.get_household_motions() is distinct from p_expected then return false; end if;
  return public.save_household_motions(p_member_id,p_motions);
end;
$function$;

create or replace function public.save_household_rhythms_checked(p_member_id uuid, p_rhythms jsonb, p_expected jsonb)
returns boolean language plpgsql security definer set search_path = public
as $function$
declare hid uuid; current_items jsonb;
begin
  select m.household_id into hid from public.household_members m
  join public.household_devices d on d.household_id = m.household_id
  where m.id = p_member_id and d.user_id = auth.uid() limit 1;
  if hid is null then raise exception 'Household access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(hid::text || ':rhythms',0));
  select coalesce(jsonb_agg(to_jsonb(r) - 'ordinality' order by r.ordinality), '[]'::jsonb) into current_items
  from public.get_household_rhythms() with ordinality r;
  if current_items is distinct from p_expected then return false; end if;
  return public.save_household_rhythms(p_member_id,p_rhythms);
end;
$function$;

-- Older clients must refresh before saving: they cannot bypass the stale-write checks.
revoke execute on function public.save_household_motions(uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.save_household_rhythms(uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.save_household_motions_checked(uuid,jsonb,jsonb) from public, anon;
revoke execute on function public.save_household_rhythms_checked(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_household_motions_checked(uuid,jsonb,jsonb) to authenticated;
grant execute on function public.save_household_rhythms_checked(uuid,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
