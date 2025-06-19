// pages/api/fromFacebookWebhook.js

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
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  try {
    const body = req.body;

    if (!body || !body.entry) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    let writeCount = 0;

    for (const entry of body.entry) {
      const changes = entry.changes || [];

      for (const change of changes) {
        const value = change.value;
        const comment_id = value.comment_id;
        const message = value.message;
        const from = value.from;
        const post_id = value.post_id;
        const created_time = value.created_time;

        // 跳过主页自己的留言
        if (!from || from.id === PAGE_ID) continue;

        // 检查留言是否包含 B 编号
        const cleaned = message.toUpperCase().replace(/\s+/g, '');
        const match = cleaned.match(/\bB(\d{1,3})\b/);
        if (!match) continue;

        const selling_id = `B${match[1].padStart(3, '0')}`;

        await db.collection('triggered_comments').doc(selling_id).set({
          comment_id,
          post_id,
          user_id: from.id,
          user_name: from.name || '',
          selling_id,
          category: 'B',
          product_name: '',
          price: 0,
          price_fmt: '',
          created_time,
          replied: false,
        });

        writeCount++;
      }
    }

    return res.status(200).json({ message: '写入完成', success: writeCount });
  } catch (err) {
    console.error('Webhook 处理失败:', err);
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
