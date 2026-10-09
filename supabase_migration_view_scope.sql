-- =============================================
-- 見積の閲覧範囲（view_scope）を人ごとに設定する
--   all : 全見積を閲覧可
--   own : 自分が作成した見積 ＋ 自分に承認依頼が来た／自分が承認した見積のみ
-- 特権管理者（super_admin）は設定に関係なく常に全件
-- =============================================

-- 1. 列の追加（新規ユーザーの既定は own）
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS view_scope TEXT NOT NULL DEFAULT 'own'
  CHECK (view_scope IN ('all', 'own'));

-- 2. 既存ユーザーの初期値：管理者系は全件、一般は自分関連のみ
UPDATE profiles SET view_scope = 'all'
  WHERE role IN ('super_admin', 'admin', 'maintenance_admin');
UPDATE profiles SET view_scope = 'own'
  WHERE role = 'general';

-- 3. 判定用の関数（RLS から呼ぶ）
CREATE OR REPLACE FUNCTION public.can_view_all_quotations()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (role = 'super_admin' OR view_scope = 'all')
  );
$$;

-- 4. 見積の閲覧ポリシー
DROP POLICY IF EXISTS "quotations_select" ON quotations;
CREATE POLICY "quotations_select" ON quotations FOR SELECT TO authenticated USING (
  public.can_view_all_quotations()
  OR created_by = auth.uid()
  OR requested_approver_id = auth.uid()
  OR approved_by = auth.uid()
);

-- 5. 見積の更新ポリシー
--    閲覧範囲が own の管理者は、自分宛ての承認依頼だけ承認（更新）できる
DROP POLICY IF EXISTS "quotations_update" ON quotations;
CREATE POLICY "quotations_update" ON quotations FOR UPDATE TO authenticated USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
      AND (view_scope = 'all' OR quotations.requested_approver_id = auth.uid())
  )
);

-- 6. 見積明細：親の見積が見える場合のみ読み書き可
DROP POLICY IF EXISTS "quotation_items_all" ON quotation_items;
CREATE POLICY "quotation_items_all" ON quotation_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_items.quotation_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_items.quotation_id));

-- 7. 採番用の関数（閲覧範囲に関係なく全件から採番し、番号重複を防ぐ）
CREATE OR REPLACE FUNCTION public.max_quotation_seq(p_prefix text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(s), 0) FROM (
    SELECT (regexp_match(base_number, '^' || p_prefix || '(\d+)'))[1]::int AS s
      FROM public.quotations WHERE base_number LIKE p_prefix || '%'
    UNION ALL
    SELECT (regexp_match(quotation_number, '^' || p_prefix || '(\d+)'))[1]::int
      FROM public.quotations WHERE quotation_number LIKE p_prefix || '%'
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.quotation_number_taken(p_base text, p_number text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.quotations
    WHERE base_number = p_base OR quotation_number = p_number
  );
$$;

CREATE OR REPLACE FUNCTION public.max_revision_number(p_base text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(revision_number), 1) FROM public.quotations WHERE base_number = p_base;
$$;

GRANT EXECUTE ON FUNCTION public.can_view_all_quotations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.max_quotation_seq(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quotation_number_taken(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.max_revision_number(text) TO authenticated;

-- 8. 本人による role / view_scope の書き換えを禁止（特権管理者のみ変更可）
--    ※ 既存の profiles_update ポリシーは「本人は自分の行を更新可」のため、
--      これが無いと一般ユーザーが自分を super_admin にできてしまう
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- サービスロール（Edge Function 等）からの更新は auth.uid() が NULL なので対象外
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.view_scope IS DISTINCT FROM OLD.view_scope)
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION '権限・閲覧範囲の変更は特権管理者のみ可能です';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_privileges ON profiles;
CREATE TRIGGER guard_profile_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();
