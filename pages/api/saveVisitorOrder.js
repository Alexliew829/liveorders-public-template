// pages/api/saveVisitorOrder.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

// 可自定义多个管理员 ID（排除）
const ADMIN_IDS = [PAGE_ID];

export default async function handler(req, res) {
  const isDebug = req.query.debug !== undefined;
  const post_id = req.query.post_id;

  if (req.method !== 'POST' && !isDebug) {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  if (!post_id) {
    return res.status(400).json({ error: '缺少 post_id 参数' });
  }

  try {
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id,created_time&limit=100`);
    const commentData = await commentRes.json();

    if (!commentData?.data?.length) {
      return res.status(200).json({ skipped: true, reason: '没有留言', raw: commentData });
    }

    let success = 0;

    for (const comment of commentData.data) {
      const { message, from, id: comment_id, created_time } = comment;
      if (!message || !from || ADMIN_IDS.includes(from.id)) continue;

      const match = message.match(/\b([aAbB])[\s0]*([0-9]{1,3})\b/);
      if (!match) continue;

      const abType = match[1].toUpperCase();
      const rawId = match[2];
      const selling_id = `${abType}${rawId.padStart(3, '0')}`;

      const productSnap = await db.collection('live_products').doc(selling_id).get();
      if (!productSnap.exists) continue;

      const product = productSnap.data();

      if (!product.allow_multiple) {
        const existing = await db.collection('triggered_comments')
          .where('selling_id', '==', selling_id)
          .get();
        if (!existing.empty) continue;
      }

      const shortId = comment_id.slice(-6);
      const payment_url = `https://pay.example.com/${selling_id}-${shortId}`;

      await db.collection('triggered_comments').doc(comment_id).set({
        selling_id,
        post_id,
        comment_id,
        user_id: from.id,
        user_name: from.name || '',
        replied: false,
        status: 'pending',
        product_name: product.product_name,
        price_fmt: product.price_fmt,
        payment_url,
        created_at: new Date(created_time || Date.now()),
      });

      success++;
    }

    return res.status(200).json({ success: true, message: `写入 ${success} 条留言` });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
