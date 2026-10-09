import { supabase } from './supabase'

// 見積番号の採番
// 閲覧範囲（RLS）で一部の見積しか見えないユーザーでも、全件を対象に採番できるよう
// DB側の SECURITY DEFINER 関数（supabase_migration_view_scope.sql）を使う。

// 新規見積の番号を払い出す（Q-YYYYMMDD-NNN-1）
export async function allocateQuotationNumber(today) {
  const prefix = `Q-${today}-`
  const { data: maxSeq, error } = await supabase.rpc('max_quotation_seq', { p_prefix: prefix })
  if (error) throw new Error(`見積番号の採番に失敗しました: ${error.message}`)

  // 念のため衝突チェック（同時作成の競合に備えて最大10回）
  let seq = Number(maxSeq || 0) + 1
  for (let i = 0; i < 10; i++) {
    const baseNumber = `${prefix}${String(seq).padStart(3, '0')}`
    const quotationNumber = `${baseNumber}-1`
    const { data: taken, error: takenErr } = await supabase.rpc('quotation_number_taken', {
      p_base: baseNumber,
      p_number: quotationNumber,
    })
    if (takenErr) throw new Error(`見積番号の確認に失敗しました: ${takenErr.message}`)
    if (!taken) return { baseNumber, quotationNumber }
    seq++
  }
  throw new Error('見積番号の採番に失敗しました（候補がすべて使用済み）')
}

// 改訂版の次のリビジョン番号を返す
export async function nextRevisionNumber(baseNumber) {
  const { data, error } = await supabase.rpc('max_revision_number', { p_base: baseNumber })
  if (error) throw new Error(`リビジョン番号の取得に失敗しました: ${error.message}`)
  return Number(data || 1) + 1
}
