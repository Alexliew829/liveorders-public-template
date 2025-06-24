// pages/api/confirmAllOrders.js
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
  const isDebug = req.query.debug !== undefined;
  if (req.method !== 'POST' && !isDebug) {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });

    // 获取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    const liveSnap = await db.collection('live_products').get();
    const liveMap = new Map();
    liveSnap.forEach(doc => {
      const data = doc.data();
      liveMap.set(doc.id, data);
    });

    let success = 0, skipped = 0;
    for (const comment of comments) {
      const { message, from, id: comment_id } = comment;
      if (!message || !from || !from.id || from.id === PAGE_ID) continue;

      const match = message.match(/\b([AB])[\-_.~ ]*0*(\d{1,3})\b/i);
      if (!match) continue;
      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;
      const product = liveMap.get(selling_id);
      if (!product) continue;

      const orderRef = db.collection('triggered_comments').doc(comment_id);
      const existing = await orderRef.get();
      if (existing.exists) {
        skipped++;
        continue;
      }

      if (type === 'B') {
        // B 类只允许一人
        const sameProduct = await db.collection('triggered_comments').where('selling_id', '==', selling_id).limit(1).get();
        if (!sameProduct.empty) {
          skipped++;
          continue;
        }
      }

      await orderRef.set({
        user_id: from.id,
        user_name: from.name || '',
        comment_id,
        selling_id,
        product_name: product.product_name,
        price: product.price,
        price_fmt: `RM ${product.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        post_id,
        created_at: new Date().toISOString(),
        replied: false
      });
      success++;
    }

    return res.status(200).json({ message: '订单写入完成', success, skipped });
  } catch (err) {
    console.error('执行失败:', err);
    return res.status(500).json({ error: '执行失败', message: err.message });
  }
}
