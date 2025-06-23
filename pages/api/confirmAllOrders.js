// pages/api/confirmAllOrders.js

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const debugSnap = await db.collection('debug_comments').orderBy('created_time').get();
    const triggeredSnap = await db.collection('triggered_comments').get();
    const liveSnap = await db.collection('live_products').get();

    const triggeredMap = new Map(); // key: selling_id + user_id
    triggeredSnap.docs.forEach(doc => {
      const data = doc.data();
      triggeredMap.set(`${data.selling_id}_${data.user_id}`, true);
    });

    const liveProducts = {}; // key: selling_id → product info
    liveSnap.docs.forEach(doc => {
      liveProducts[doc.id] = doc.data();
    });

    const count = { success: 0, skipped: 0 };
    const firstBuyerMap = {}; // key: selling_id → user_id

    for (const doc of debugSnap.docs) {
      const data = doc.data();
      const { message, comment_id, created_time, from, post_id } = data;
      const user_id = from?.id;
      const user_name = from?.name || '匿名用户';

      if (!message || !user_id) {
        count.skipped++;
        continue;
      }

      const match = message.toUpperCase().match(/([AB])\s*0*(\d{1,3})/);
      if (!match) {
        count.skipped++;
        continue;
      }

      const category = match[1];
      const number = match[2].padStart(3, '0');
      const selling_id = `${category}${number}`;
      const key = `${selling_id}_${user_id}`;

      // 是否已写入？
      if (triggeredMap.has(key)) {
        count.skipped++;
        continue;
      }

      // 找不到商品资料
      const product = liveProducts[selling_id];
      if (!product) {
        count.skipped++;
        continue;
      }

      // B 类：只认第一位
      if (category === 'B') {
        if (firstBuyerMap[selling_id]) {
          count.skipped++;
          continue;
        }
        firstBuyerMap[selling_id] = user_id;
      }

      await db.collection('triggered_comments').add({
        comment_id,
        created_at: created_time,
        from,
        post_id,
        selling_id,
        status: 'pending',
        replied: false,
        sent_at: '',
        product_name: product.product_name || '',
        price: product.price || 0,
        price_fmt: product.price_fmt || '',
        user_id,
        user_name,
        category
      });

      triggeredMap.set(key, true);
      count.success++;
    }

    return res.status(200).json({ message: '订单写入完成', ...count });
  } catch (err) {
    console.error('[写入订单失败]', err);
    return res.status(500).json({ error: '处理失败', detail: err.message });
  }
}
