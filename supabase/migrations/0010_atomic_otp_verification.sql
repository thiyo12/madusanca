-- Serialize OTP checks so concurrent wrong guesses cannot lose attempt counts.
drop function if exists public.verify_booking_otp(text, text);
create or replace function public.verify_booking_otp(p_email text, p_code_hash text, p_consume boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_otp public.booking_otps%rowtype;
begin
  select * into v_otp from public.booking_otps
    where email = lower(trim(p_email)) for update;
  if not found then return 'expired'; end if;
  if v_otp.expires_at <= now() then
    delete from public.booking_otps where email = lower(trim(p_email));
    return 'expired';
  end if;
  if v_otp.attempts >= 5 then return 'locked'; end if;
  if v_otp.code_hash <> p_code_hash then
    update public.booking_otps set attempts = attempts + 1
      where email = lower(trim(p_email));
    return 'mismatch';
  end if;
  if p_consume then
    delete from public.booking_otps where email = lower(trim(p_email));
  end if;
  return 'ok';
end;
$$;

revoke all on function public.verify_booking_otp(text, text, boolean) from public, anon, authenticated;
grant execute on function public.verify_booking_otp(text, text, boolean) to service_role;
