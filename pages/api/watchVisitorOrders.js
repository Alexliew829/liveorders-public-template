// pages/api/watchVisitorOrders.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  const { post_id } = req.query;
  if (!post_id) {
    return res.status(400).json({ error: '缺少 post_id 参数' });
  }

  try {
    const commentRes = await fetch(
      `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id,created_time&limit=100`
    );
    const commentData = await commentRes.json();

    if (!commentData?.data?.length) {
      return res.status(404).json({ error: '找不到任何留言', raw: commentData });
    }

    let successCount = 0;
    for (const comment of commentData.data) {
      const { message, from, id: comment_id, created_time } = comment;
      if (!message || !from?.id || from.id === PAGE_ID) continue; // 跳过主页或无ID留言

      const regex = /[Bb][^\d]*(\d{1,3})/;
      const match = message.match(regex);
      if (!match) continue;

      const rawId = match[1];
      const selling_id = `B${rawId.padStart(3, '0')}`;

      // 是否已记录这个商品的留言者（避免重复写入）
      const existing = await db
        .collection('triggered_comments')
        .where('post_id', '==', post_id)
        .where('selling_id', '==', selling_id)
        .limit(1)
        .get();

      if (!existing.empty) continue;

      const user_id = from.id;
      const user_name = from.name || '';

      const payment_url = `https://your-site.com/pay?product=${selling_id}&uid=${user_id}`;

      await db.collection('triggered_comments').doc(comment_id).set({
        comment_id,
        post_id,
        selling_id,
        user_id,
        user_name,
        payment_url,
        status: 'pending',
        replied: false,
        created_at: new Date(),
      });

      successCount++;
    }

    return res.status(200).json({ success: true, inserted: successCount });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
