import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const PAGE_ID = process.env.PAGE_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const body = req.body;
    const entries = body.entry || [];

    let success = 0, skipped = 0;

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value;
        const comment = value.comment;
        if (!comment) {
          skipped++;
          continue;
        }

        const { id: comment_id, message, created_time, from, post_id } = comment;

        // 忽略主页留言
        if (!from || from.id === PAGE_ID) {
          skipped++;
          continue;
        }

        // 写入 debug_comments（调试用）
        await db.collection('debug_comments').add({
          comment_id,
          message,
          from,
          created_time,
          post_id
        });

        // 写入 triggered_comments
        const selling_idMatch = message?.toUpperCase().match(/B\s*\d{1,3}/);
        if (!selling_idMatch) {
          skipped++;
          continue;
        }

        const selling_id = 'B' + selling_idMatch[0].replace(/\D/g, '').padStart(3, '0');

        await db.collection('triggered_comments').add({
          comment_id,
          created_at: created_time,
          from,
          post_id,
          selling_id,
          status: 'pending',
          replied: false,
          sent_at: '',
          product_name: '',
          price: 0,
          price_fmt: '',
          user_id: from.id || '',
          user_name: from.name || '',
          category: 'B'
        });

        success++;
      }
    }

    return res.status(200).json({ message: '识别完成', success, skipped });
  } catch (err) {
    console.error('Webhook 错误：', err);
    return res.status(500).json({ error: '处理失败', detail: err.message });
  }
}
