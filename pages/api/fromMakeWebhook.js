// pages/api/fromMakeWebhook.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '仅允许 POST 请求' });

  try {
    const { post_id, comment_id, message, user_id, user_name } = req.body;

    if (!message || !user_id || !comment_id) {
      return res.status(400).json({ error: '留言资料不完整' });
    }

    const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
    if (!match) {
      return res.status(400).json({ error: '留言不含有效编号' });
    }

    const type = match[1].toUpperCase();
    const number = match[2].padStart(3, '0');
    const selling_id = `${type}${number}`;

    const docRef = db.collection('triggered_comments').doc(comment_id);
    const doc = await docRef.get();
    if (doc.exists) {
      return res.status(200).json({ message: '已存在，无需重复写入' });
    }

    await docRef.set({
      comment_id,
      message,
      user_id,
      user_name: user_name || '匿名访客',
      selling_id,
      post_id,
      created_at: new Date().toISOString()
    });

    res.status(200).json({ message: '访客留言写入成功' });
  } catch (err) {
    console.error('留言处理错误：', err);
    res.status(500).json({ error: '留言处理失败', details: err.message });
  }
}
