-- The welcome email after a Stripe payment can fail (a bad address, the
-- email service down). The membership still goes through; the failure is
-- kept here so /admin/billing can list who needs their invite resent.
-- Cleared when an admin sends the invite again.
alter table public.membership_billing
  add column if not exists welcome_email_error text;
