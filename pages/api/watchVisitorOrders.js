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

    const liveProducts = await db.collection('live_products').get();
    const productMap = {};
    liveProducts.forEach((doc) => {
      const data = doc.data();
      productMap[data.selling_id] = data;
    });

    const triggered = new Set();
    const written = [];

    for (const comment of commentData.data) {
      const { message, from, id: comment_id } = comment;
      if (!message || !from || from.id === PAGE_ID) continue; // 忽略主页

      const match = message.match(/[Bb]\s*0*(\d{1,3})/);
      if (!match) continue;

      const rawId = match[1];
      const selling_id = `B${rawId.padStart(3, '0')}`;

      if (triggered.has(selling_id)) continue;

      const product = productMap[selling_id];
      if (!product) continue;

      // 检查是否已有顾客留言
      const existing = await db
        .collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .get();
      if (!existing.empty) continue;

      const user_id = from.id || '';
      const user_name = from.name || '';

      const payment_url = `https://pay.example.com/${selling_id}-${comment_id}`;

      await db.collection('triggered_comments').doc(comment_id).set({
        selling_id,
        post_id,
        comment_id,
        user_id,
        user_name,
        product_name: product.product_name,
        price_fmt: product.price_fmt,
        price_raw: product.price_raw,
        payment_url,
        status: 'pending',
        replied: false,
        created_at: new Date(),
      });

      triggered.add(selling_id);
      written.push({ comment_id, selling_id });
    }

    return res.status(200).json({ success: true, inserted: written.length, written });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
