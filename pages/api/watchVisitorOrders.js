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
      if (!message || !from?.id || from.id === PAGE_ID) continue; // 忽略管理员留言

      // 宽容识别 B 编号（不区分大小写、不限空格）
      const regex = /[Bb]\s*0*(\d{1,3})\b/;
      const match = message.match(regex);
      if (!match) continue;

      const rawId = match[1];
      const selling_id = `B${rawId.padStart(3, '0')}`;

      const productSnap = await db.collection('live_products').doc(selling_id).get();
      if (!productSnap.exists) continue; // 无此商品

      const product = productSnap.data();

      // 是否已有顾客抢先留言
      const existsSnap = await db.collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .limit(1)
        .get();
      if (!existsSnap.empty) continue;

      const user_id = from.id;
      const user_name = from.name || '';

      const payment_url = `https://pay.example.com/${selling_id}-${comment_id}`;

      // 写入订单
      await db.collection('triggered_comments').doc(comment_id).set({
        selling_id,
        comment_id,
        user_id,
        user_name,
        product_name: product.product_name,
        price_fmt: product.price_fmt,
        payment_url,
        replied: false,
        status: 'pending',
        created_at: new Date()
      });

      successCount++;
    }

    return res.status(200).json({ success: true, inserted: successCount });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
