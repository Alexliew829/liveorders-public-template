import { cert, getApps, initializeApp } from 'firebase-admin/app';
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

  const { post_id, comment_id, message, user_id, user_name } = req.body;
  if (!message || !comment_id || !post_id) {
    return res.status(400).json({ error: '缺少必要字段' });
  }

  try {
    // 提取编号（如 A23、b 001、B88）
    const match = message.match(/\b([ABab])[\s\-_]*0*([1-9][0-9]?)\b/);
    if (!match) {
      return res.status(400).json({ error: '无效留言格式' });
    }

    const type = match[1].toUpperCase(); // A 或 B
    const number = match[2];
    const selling_id = `${type}${number.padStart(3, '0')}`;

    const commentRef = db.collection('triggered_comments');
    const query = commentRef.where('selling_id', '==', selling_id);

    if (type === 'B') {
      const existing = await query.limit(1).get();
      if (!existing.empty) {
        return res.status(200).json({ message: 'B类商品已有顾客' });
      }
    } else {
      const duplicate = await commentRef
        .where('selling_id', '==', selling_id)
        .where('user_id', '==', user_id)
        .limit(1)
        .get();
      if (!duplicate.empty) {
        return res.status(200).json({ message: 'A类商品该顾客已下单' });
      }
    }

    await commentRef.add({
      post_id,
      comment_id,
      message,
      user_id,
      user_name: user_name || '',
      selling_id,
      created_at: Date.now(),
      replied: false,
    });

    return res.status(200).json({ success: true, selling_id });
  } catch (err) {
    console.error('写入失败', err);
    return res.status(500).json({ error: '写入失败', details: err.message });
  }
}
