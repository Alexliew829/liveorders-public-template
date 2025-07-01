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

    const orders = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      orders.push({
        comment_id: data.comment_id,
        user_name: data.user_name || '',
        selling_id: data.selling_id,
        product_name: data.product_name,
        quantity: data.quantity || 1,
        price: data.price || '',
        price_fmt: data.price_fmt || '',
        payment_url: data.payment_url || '',
      });
    });

    return res.status(200).json(orders);
  } catch (err) {
    return res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
