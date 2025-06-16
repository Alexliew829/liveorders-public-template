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
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id,created_time&limit=100`);
    const commentData = await commentRes.json();

    if (!commentData?.data?.length) {
      return res.status(404).json({ error: '找不到留言', raw: commentData });
    }

    let inserted = 0;

    for (const comment of commentData.data) {
      const { message, from, id: comment_id, created_time } = comment;

      if (!message || !from?.id || from.id === PAGE_ID) continue; // 跳过主页/管理员

      // 宽容匹配 B 编号（如 b1、b 01、b001）
      const match = message.match(/(?:^|\s)[Bb]\s*0*(\d{1,3})(?:\s|$)/);
      if (!match) continue;

      const rawId = match[1];
      const selling_id = `B${rawId.padStart(3, '0')}`;

      // 检查是否已有顾客抢先留言（避免重复写入）
      const existing = await db.collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .limit(1)
        .get();
      if (!existing.empty) continue;

      // 获取商品资料
      const productSnap = await db.collection('live_products').doc(selling_id).get();
      if (!productSnap.exists) continue;

      const product = productSnap.data();
      const payment_url = `https://pay.example.com/${selling_id}-${comment_id}`;

      await db.collection('triggered_comments').doc(comment_id).set({
        selling_id,
        post_id,
        comment_id,
        user_id: from.id,
        user_name: from.name || '',
        created_at: new Date(created_time),
        payment_url,
        product_name: product.product_name || '',
        price_fmt: product.price_fmt || '',
        price_raw: product.price_raw || '',
      });

      inserted++;
    }

    return res.status(200).json({ success: true, inserted });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
