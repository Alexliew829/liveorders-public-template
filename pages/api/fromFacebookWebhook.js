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

    if (!body || !body.entry || !Array.isArray(body.entry)) {
      return res.status(400).json({ error: '无效的 Webhook 数据结构' });
    }

    const debugCollection = db.collection('debug_comments');

    for (const entry of body.entry) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const comment = change.value;

        const from = comment.from;
        const message = comment.message || '';
        const post_id = comment.post_id || '';
        const comment_id = comment.comment_id || '';
        const created_time = comment.created_time || '';

        // 忽略主页留言（只处理访客）
        if (from?.id === PAGE_ID) continue;

        // 查找留言中是否包含 B 编号
        const cleanMsg = message.toUpperCase().replace(/\s+/g, '');
        const match = cleanMsg.match(/\bB(\d{1,3})\b/);
        if (!match) continue;

        const selling_id = `B${match[1].padStart(3, '0')}`;

        await db.collection('triggered_comments').doc(selling_id).set({
          comment_id,
          created_at: created_time,
          from,
          message,
          post_id,
          user_id: from?.id || '',
          user_name: from?.name || '',
          selling_id,
          replied: false,
          product_name: '',
          price: 0,
          price_fmt: '',
          sent_at: '',
          status: 'pending'
        });
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Webhook 处理失败:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: err.message });
  }
}
