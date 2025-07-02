import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  try {
    const snapshot = await db
      .collection('triggered_comments')
      .orderBy('created_at', 'asc')
      .get();

    const map = new Map();

    snapshot.forEach(doc => {
      const data = doc.data();

      if (data.replied === true) return;

      const user_id = data.user_id || 'anonymous';
      const user_name = data.user_name || '匿名顾客';
      const key = user_id;

      const rawPrice = typeof data.price === 'string' ? data.price.replace(/,/g, '') : data.price;
      const unitPrice = parseFloat(rawPrice) || 0;

      const item = {
        selling_id: data.selling_id || '',
        product_name: data.product_name || '',
        quantity: data.quantity || 1,
        price: unitPrice,
        subtotal: unitPrice * (data.quantity || 1),
      };

      if (!map.has(key)) {
        map.set(key, {
          user_id,
          user_name,
          comment_id: data.comment_id || '',
          items: [item],
          total: item.subtotal,
        });
      } else {
        const existing = map.get(key);
        existing.items.push(item);
        existing.total += item.subtotal;
        // 保留最晚的 comment_id 以便后续留言回复
        existing.comment_id = data.comment_id || existing.comment_id;
      }
    });

    const result = Array.from(map.values());
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
