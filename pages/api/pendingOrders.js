// pages/api/pendingOrders.js

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
      .where('replied', '==', false)
      .orderBy('created_at', 'asc')
      .get();

    const map = new Map();

    snapshot.forEach(doc => {
      const data = doc.data();
      const user = data.user_name || '匿名顾客';
      const key = user;

      const item = {
        selling_id: data.selling_id,
        product_name: data.product_name,
        quantity: data.quantity || 1,
        price: parseFloat(data.price) || 0,
        subtotal: (parseFloat(data.price) || 0) * (data.quantity || 1),
      };

      if (!map.has(key)) {
        map.set(key, {
          user_name: user,
          items: [item],
          total: item.subtotal,
        });
      } else {
        const existing = map.get(key);
        existing.items.push(item);
        existing.total += item.subtotal;
      }
    });

    const result = Array.from(map.values());
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
