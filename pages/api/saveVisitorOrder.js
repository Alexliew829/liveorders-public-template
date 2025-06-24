// pages/api/saveVisitorOrder.js
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const { selling_id, user_id, user_name, comment_id, post_id, created_time } = req.body;

    if (!selling_id || !comment_id) {
      return res.status(400).json({ error: '缺少必要字段' });
    }

    await db.collection('triggered_comments').doc(comment_id).set({
      selling_id: selling_id.toUpperCase(),
      user_id,
      user_name,
      comment_id,
      post_id,
      created_time,
    });

    res.status(200).json({ message: '留言写入成功' });
  } catch (err) {
    res.status(500).json({ error: '留言写入失败', details: err.message });
  }
}
