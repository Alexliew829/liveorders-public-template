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
      if (!message || !from || !from.id) continue;

      // 跳过主页与管理员留言
      if (from.id === PAGE_ID || from.name?.includes('Lover Legend Gardening')) continue;

      // 识别留言格式：B1、b01、B001、b 01 等等
      const match = message.match(/\b[bB][\s0]*([0-9]{1,3})\b/);
      if (!match) continue;

      const rawId = match[1];
      const selling_id = `B${rawId.padStart(3, '0')}`;

      // 检查是否已有访客下单该商品
      const existing = await db.collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .get();
      if (!existing.empty) continue; // 只允许第一个留言者

      // 从 live_products 获取商品资料
      const productSnap = await db.collection('live_products').doc(selling_id).get();
      if (!productSnap.exists) continue;
      const product = productSnap.data();

      const user_id = from.id;
      const user_name = from.name || '';

      const shortId = comment_id.slice(-6);
      const payment_url = `https://pay.example.com/${selling_id}-${shortId}`;

      // 写入触发记录
      await db.collection('triggered_comments').doc(comment_id).set({
        selling_id,
        post_id,
        comment_id,
        user_id,
        user_name,
        replied: false,
        status: 'pending',
        product_name: product.product_name,
        price_fmt: product.price_fmt,
        payment_url,
        created_at: new Date(),
      });

      // 可以在这里调用自动回复系统（Catalog/Make），或后续处理

      successCount++;
    }

    return res.status(200).json({ success: true, inserted: successCount });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
