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
    // 取得最新留言
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
      if (!message || !from?.id || !from?.name) continue;

      // 识别留言格式：B01 或 b001（允许空格）
      const match = message.match(/[Bb]\s*0*(\d{1,3})\b/);
      if (!match) continue;

      const rawId = match[1];
      const selling_id = `B${rawId.padStart(3, '0')}`;

      // 检查是否已存在该商品的下单记录（即已有顾客留言成功）
      const existing = await db
        .collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .where('post_id', '==', post_id)
        .limit(1)
        .get();

      if (!existing.empty) continue; // 已有顾客抢单，跳过

      // 取得商品信息（从 live_products 表）
      const productSnap = await db.collection('live_products').doc(selling_id).get();
      if (!productSnap.exists) continue;

      const product = productSnap.data();

      // 构建付款连接（此处可替换成真实服务端 URL）
      const payment_url = `https://your-site.com/pay?product=${selling_id}&uid=${from.id}`;

      // 写入 triggered_comments 表
      await db.collection('triggered_comments').doc(comment_id).set({
        selling_id,
        post_id,
        comment_id,
        user_id: from.id,
        user_name: from.name,
        payment_url,
        status: 'pending',
        replied: false,
        created_at: new Date(created_time),
      });

      successCount++;
    }

    return res.status(200).json({ success: true, inserted: successCount });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
