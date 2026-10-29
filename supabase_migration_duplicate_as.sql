-- 特権管理者のみ、他のユーザーを作成者にした見積を作成できるようにする
-- （見積一覧の「複製」で作成者を選んで出し直す機能用）
-- 既存の quotations_insert（作成者＝自分のみ）はそのまま。ポリシーはOR評価なので一般ユーザーの制限は変わらない
DROP POLICY IF EXISTS "quotations_insert_super_admin" ON quotations;
CREATE POLICY "quotations_insert_super_admin" ON quotations FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
);
