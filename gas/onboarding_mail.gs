/**
 * =====================================================
 * 10X 入社フォーム（tenx-joinform）確認メール送信 - Google Apps Script
 * =====================================================
 * フォーム送信後、ブラウザから { id } だけを受け取り、
 * Supabase の claim_onboarding_mail 関数で内容を取得して
 * 「本人」と「人事」に回答内容入りの確認メールを送る。
 *
 *  - 内容は必ずDBから読む（ブラウザから送られた本文は使わない）
 *  - 1件につき1回だけ・送信から30分以内のみ（DB関数側で制御）
 *  - マイナンバーはメールに記載しない／口座番号などは末尾3桁のみ（DB関数側でマスク）
 *  - anon キーのみ使用（service_role キーはここに置かない）
 *
 * 【セットアップ】（y.nakatani@tenx.jp のアカウントで）
 * 1. https://script.google.com で新しいプロジェクトを作り、このファイルを貼り付けて保存
 * 2. プロジェクトの設定 → スクリプト プロパティに追加
 *      SUPABASE_URL      : https://ukbberjymhmnlkrwrayl.supabase.co
 *      SUPABASE_ANON_KEY : フォームの .env の VITE_SUPABASE_ANON_KEY と同じ値
 *      HR_EMAIL          : y.nakatani@tenx.jp
 * 3. testSetup を1回実行して権限を承認
 * 4. デプロイ → 新しいデプロイ → ウェブアプリ（実行: 自分 ／ アクセス: 全員）
 * 5. 発行URLを フォームの .env の VITE_ONBOARDING_MAIL_URL に設定して再ビルド・デプロイ
 * =====================================================
 */

const P = PropertiesService.getScriptProperties();
const SUPABASE_URL = P.getProperty('SUPABASE_URL');
const SUPABASE_ANON_KEY = P.getProperty('SUPABASE_ANON_KEY');
const HR_EMAIL = P.getProperty('HR_EMAIL') || 'y.nakatani@tenx.jp';
const SENDER_NAME = '10X株式会社 コーポレート事業部';
const ADMIN_URL = 'https://tenx-joinform.pages.dev/onboarding-admin';

function doPost(e) {
  try {
    const id = String(JSON.parse(e.postData.contents).id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ status: 'error', message: 'invalid id' });

    const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/claim_onboarding_mail', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      payload: JSON.stringify({ p_id: id }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return json({ status: 'error', message: 'db ' + res.getResponseCode() });
    const r = JSON.parse(res.getContentText());
    if (!r) return json({ status: 'skip', message: 'already sent or expired' });

    const name = `${r.last_name || ''} ${r.first_name || ''}`.trim() || '（氏名未入力）';
    const answers = buildAnswers(r);
    const now = Utilities.formatDate(new Date(r.created_at), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

    const userBody =
`${name} 様

10X株式会社 コーポレート事業部の中谷です。
入社情報フォームの送信を受け付けました。ありがとうございます。
送信いただいた内容は以下のとおりです。

受付日時：${now}
${answers}

────────────────────
※ マイナンバーはセキュリティのためメールには記載していません。
※ 口座番号・雇用保険番号・基礎年金番号は末尾3桁のみ表示しています。

内容に誤りがある場合は、このメールに返信してお知らせください。

10X株式会社 コーポレート事業部
${HR_EMAIL}
`;

    const hrBody =
`【入社フォーム】${name}（入社予定日 ${r.employment_date || '未入力'}）から送信がありました。
本人メール：${r.email}
受付日時：${now}
${answers}

────────────────────
全項目（マイナンバー等）は管理画面で確認してください：
${ADMIN_URL}
`;

    let userSent = false, hrSent = false;
    try {
      GmailApp.sendEmail(r.email, '【10X】入社情報フォームを受け付けました', userBody, { name: SENDER_NAME, replyTo: HR_EMAIL });
      userSent = true;
    } catch (err) { console.error('本人宛送信失敗', err); }
    try {
      GmailApp.sendEmail(HR_EMAIL, `【入社フォーム】${name} さんの回答控え`, hrBody, { name: SENDER_NAME, replyTo: r.email });
      hrSent = true;
    } catch (err) { console.error('人事宛送信失敗', err); }

    return json({ status: 'ok', userSent: userSent, hrSent: hrSent });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  }
}

// ===== 本文 =====
const L = {
  gender: { male: '男性', female: '女性' },
  yn: { yes: 'あり', no: 'なし' },
  widow: { widow: '寡婦', singleParent: 'ひとり親', none: '対象外' },
  student: { yes: '該当あり', no: '該当なし' },
  acct: { ordinary: '普通', current: '当座' },
  method: { train: '電車', bus: 'バス', car: '車', bicycle: '自転車' },
};
const v = x => (x === null || x === undefined || x === '') ? '（未入力）' : String(x);
const map = (m, x) => m[x] || v(x);

function buildAnswers(r) {
  const s = [];
  const sec = t => s.push('', `■ ${t}`);
  const row = (k, x) => s.push(`・${k}：${x}`);

  sec('基本情報');
  row('氏名', `${v(r.last_name)} ${v(r.first_name)}（${v(r.last_name_kana)} ${v(r.first_name_kana)}）`);
  row('入社年月日', v(r.employment_date));
  row('生年月日', v(r.birth_date));
  row('性別', map(L.gender, r.gender));

  sec('配偶者');
  row('配偶者', map(L.yn, r.has_spouse));
  if (r.has_spouse === 'yes') {
    row('氏名', `${v(r.spouse_name)}（${v(r.spouse_name_kana)}）`);
    row('生年月日', v(r.spouse_birth_date));
    row('性別', map(L.gender, r.spouse_gender));
    row('職業', v(r.spouse_occupation));
    row('扶養', r.spouse_dependent === 'yes' ? '扶養する' : r.spouse_dependent === 'no' ? '扶養しない' : '（未入力）');
    if (r.spouse_dependent === 'yes') row('配偶者のマイナンバー', r.spouse_my_number_registered ? '登録済み（メールには記載しません）' : '（未入力）');
  }

  sec('税務関連');
  row('寡婦・ひとり親', map(L.widow, r.widow_status));
  row('障害', map(L.yn, r.has_disability));
  row('勤労学生', map(L.student, r.is_working_student));

  sec('住所・世帯');
  row('住民票住所', `〒${v(r.registered_postal_code)} ${v(r.registered_address)}${r.registered_address_detail || ''}`);
  row('現住所', r.same_address ? '住民票住所と同じ'
    : `〒${v(r.current_postal_code)} ${v(r.current_address)}${r.current_address_detail || ''}`);
  row('世帯主', `${v(r.household_head)}（続柄：${v(r.household_relationship)}）`);

  sec('扶養家族');
  const fam = r.has_family_members === 'yes' ? (r.family_members || []) : [];
  if (r.has_spouse === 'yes' && r.spouse_dependent === 'yes') s.push(`・配偶者：${v(r.spouse_name)}`);
  else if (!fam.length) s.push('・なし');
  fam.forEach((m, i) => row(`${i + 1}人目`, `${v(m.name)}（${v(m.nameKana)}）／${v(m.relationship)}／${v(m.birthDate)}／${map(L.gender, m.gender)}／職業：${v(m.occupation)}`));

  sec('連絡先・各種番号');
  row('携帯電話番号', v(r.phone_number));
  row('雇用保険被保険者番号', v(r.employment_insurance_number));
  row('基礎年金番号', v(r.basic_pension_number));
  row('マイナンバー', r.my_number_registered ? '登録済み（メールには記載しません）' : '（未入力）');

  sec('振込口座');
  row('口座', `${v(r.bank_name)} ${v(r.bank_branch_name)} ${map(L.acct, r.bank_account_type)} ${v(r.bank_account_number)}`);
  row('名義', v(r.bank_account_holder));

  sec('緊急連絡先');
  const ecs = (r.emergency_contacts || []).filter(c => c && c.name);
  if (!ecs.length) s.push('・（未入力）');
  ecs.forEach((c, i) => row(`${i + 1}`, `${v(c.name)}（${v(c.nameKana)}）／続柄：${v(c.relationship)}／${v(c.phone)}／${v(c.address)}／${v(c.email)}`));

  sec('通勤');
  if (r.has_commuting !== 'yes') s.push('・申請なし');
  else {
    row('通勤先', `${v(r.commuting_destination_name)}（${v(r.commuting_destination_address)}）`);
    (r.commuting_legs || []).forEach((l, i) =>
      row(`区間${i + 1}`, `${map(L.method, l.method)} ${v(l.from)} → ${v(l.to)}${l.fare ? `（${l.fare}円）` : ''}`));
  }

  sec('書類');
  row('健康診断書', r.health_cert_uploaded ? 'アップロード済み' : '未提出・後日提出');
  row('プロフィール写真', r.profile_photo_uploaded ? 'アップロード済み' : '未提出');

  sec('秘密保持誓約書');
  row('freeeサイン案内', r.freee_sign_notice_acknowledged ? '確認済み' : '未確認');

  return s.join('\n');
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// 権限承認用（エディタから1回実行）
function testSetup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('スクリプトプロパティを設定してください');
  Logger.log('Gmail送信残数: ' + MailApp.getRemainingDailyQuota());
  GmailApp.getAliases();
}
