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
    const snapshot = await db.collection('debug_comments').get();
    let success = 0, skipped = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const { message = '', comment_id, created_at, post_id, from } = data;
      const user_id = from?.id;
      const user_name = from?.name || '匿名用户';

      const normalized = message.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const match = normalized.match(/^([AB])0*(\\d{1,3})$/);
      if (!match) {
        skipped++;
        continue;
      }

      const category = match[1];
      const number = match[2].padStart(3, '0');
      const selling_id = category + number;

      const productRef = db.collection('live_products').doc(selling_id);
      const productSnap = await productRef.get();
      if (!productSnap.exists) {
        skipped++;
        continue;
      }

      const product = productSnap.data();

      if (product.category === 'B') {
        const exists = await db.collection('triggered_comments')
          .where('selling_id', '==', selling_id).limit(1).get();
        if (!exists.empty) {
          skipped++;
          continue;
        }
      }

      await db.collection('triggered_comments').doc(comment_id).set({
        user_id,
        user_name,
        comment_id,
        post_id,
        created_time: created_at,
        selling_id,
        category,
        product_name: product.product_name,
        price: product.price,
        price_fmt: product.price_fmt,
        replied: false,
        status: 'pending',
        sent_at: ''
      });

      success++;
    }

    return res.status(200).json({ message: '批量写入完成', success, skipped });
  } catch (err) {
    console.error('❌ 批量写入失败', err);
    return res.status(500).json({ error: '处理失败', detail: err.message });
  }
}
