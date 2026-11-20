alter table if exists public.onboarding_submissions
  add column if not exists onboarding_notification_attempted_at timestamptz,
  add column if not exists onboarding_notification_sent_at timestamptz,
  add column if not exists onboarding_notification_error text;

comment on column public.onboarding_submissions.onboarding_notification_attempted_at
  is 'Last attempt to notify the designated onboarding administrator by email.';
comment on column public.onboarding_submissions.onboarding_notification_sent_at
  is 'Successful onboarding administrator email notification timestamp.';
comment on column public.onboarding_submissions.onboarding_notification_error
  is 'Most recent onboarding administrator email notification error.';

-- 旧GAS確認メール用の匿名RPCは廃止し、通知を認証済みEdge Functionへ一本化する。
drop function if exists public.claim_onboarding_mail(uuid);
drop function if exists public.mask_tail(text);
