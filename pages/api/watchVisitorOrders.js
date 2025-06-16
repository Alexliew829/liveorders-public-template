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
      `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id&limit=100`
    );
    const commentData = await commentRes.json();
    if (!commentData?.data?.length) {
      return res.status(404).json({ error: '找不到任何留言', raw: commentData });
    }

    let successCount = 0;
    for (const comment of commentData.data) {
      const { message, from, id: comment_id } = comment;
      if (!message || !from || from.id === PAGE_ID) continue; // 跳过管理员留言

      // 判断留言是否为商品编号，如 b01 / B 01 / B001
      const match = message.match(/[Bb]\s*0*(\d{1,3})/);
      if (!match) continue;

      const rawId = match[1];
      const selling_id = `B${rawId.padStart(3, '0')}`;

      // 检查是否已经写入该商品编号的留言者
      const existing = await db
        .collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .limit(1)
        .get();
      if (!existing.empty) continue; // 已经有人抢先下单了

      // 查找商品资料
      const productSnap = await db.collection('live_products').doc(selling_id).get();
      if (!productSnap.exists) continue; // 没有对应商品
      const product = productSnap.data();

      // 构造付款链接（此处需替换为你实际的支付网址）
      const payment_url = `https://pay.example.com/${selling_id}-${comment_id}`;

      // 回复内容（如能抓到顾客名就加上）
      const userTag = from.name ? `@${from.name} ` : '';
      const replyText = `感谢下单 ${userTag}🙏\n${selling_id} ${product.product_name} RM${product.price_fmt}\n付款连接：${payment_url}`;

      // 发送留言回复（Graph API）
      await fetch(`https://graph.facebook.com/${comment_id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: replyText,
          access_token: PAGE_TOKEN,
        }),
      });

      // 写入 triggered_comments
      await db.collection('triggered_comments').doc(comment_id).set({
        comment_id,
        selling_id,
        post_id,
        user_id: from.id || '',
        user_name: from.name || '',
        payment_url,
        created_at: new Date(),
      });

      successCount++;
    }

    return res.status(200).json({ success: true, inserted: successCount });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
