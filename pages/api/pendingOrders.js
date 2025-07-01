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

    const allOrders = [];
    snapshot.forEach(doc => allOrders.push(doc.data()));

    const result = [];
    const bSeen = new Set();

    for (const data of allOrders) {
      const selling_id = (data.selling_id || '').trim().toUpperCase();
      const isA = selling_id.startsWith('A');
      const isB = selling_id.startsWith('B');

      // A类商品：全部加入
      if (isA) {
        result.push({
          comment_id: data.comment_id,
          user_name: data.user_name || '',
          selling_id: data.selling_id,
          product_name: data.product_name,
          quantity: data.quantity || 1,
          price: data.price || '',
          payment_url: data.payment_url || '',
        });
      }

      // B类商品：只加入第一位留言者
      else if (isB && !bSeen.has(selling_id)) {
        bSeen.add(selling_id);
        result.push({
          comment_id: data.comment_id,
          user_name: data.user_name || '',
          selling_id: data.selling_id,
          product_name: data.product_name,
          quantity: data.quantity || 1,
          price: data.price || '',
          payment_url: data.payment_url || '',
        });
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
