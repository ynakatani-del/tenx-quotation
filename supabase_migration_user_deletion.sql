-- =============================================
-- ユーザー削除の見直し
--   ・ログイン用アカウント(auth.users)を消しても、ユーザー情報(profiles)の行は残す
--     → 過去の見積・出張申請・案件などの作成者名を保持し、連動削除も起きない
--   ・削除時刻(deleted_at)を記録し、7日たったらユーザー管理の一覧から非表示にする（画面側）
--   ・これまでの削除で残ってしまったログイン用アカウントを削除し、同じメールで再作成できるようにする
-- =============================================
BEGIN;

-- 1. profiles → auth.users の連動削除(CASCADE)を外す
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.profiles'::regclass AND contype = 'f'
             AND confrelid = 'auth.users'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 2. 承認依頼先の紐付けを auth.users → profiles に付け替える
--    （ログイン用アカウントを消しても、過去の承認依頼の記録は残る）
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.quotations'::regclass AND contype = 'f'
             AND confrelid = 'auth.users'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.quotations DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.quotations
  ADD CONSTRAINT quotations_requested_approver_id_fkey
  FOREIGN KEY (requested_approver_id) REFERENCES public.profiles(id) NOT VALID;

-- 3. 削除時刻の列と、status が deleted になった時に自動で記録するトリガー
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
UPDATE public.profiles SET deleted_at = now() WHERE status = 'deleted' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_profile_deleted_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'deleted' AND OLD.status IS DISTINCT FROM 'deleted' THEN
    NEW.deleted_at := now();
  ELSIF NEW.status IS DISTINCT FROM 'deleted' THEN
    NEW.deleted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profile_deleted_at ON public.profiles;
CREATE TRIGGER set_profile_deleted_at
  BEFORE UPDATE OF status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_profile_deleted_at();

-- 4. 削除済みなのに残っているログイン用アカウントを削除（profiles の行は残る）
DELETE FROM auth.users AS u
USING public.profiles AS p
WHERE p.id = u.id AND p.status = 'deleted';

COMMIT;
