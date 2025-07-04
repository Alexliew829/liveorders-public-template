import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  try {
    const snapshot = await db.collection('triggered_comments')
      .where('replied', '==', false)
      .orderBy('created_at', 'asc')
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ orders: [] });
    }

    const orders = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      orders.push({
        id: doc.id,
        user_name: data.user_name || '',
        selling_id: data.selling_id || '',
        product_name: data.product_name || '',
        quantity: data.quantity || 1,
        price: data.price || 0,
        comment_id: data.comment_id || '',
        replied: data.replied || false,
      });
    });

    return res.status(200).json({ orders });
  } catch (err) {
    console.error('❌ 读取订单失败：', err);
    return res.status(500).json({ error: '读取订单失败', details: err.message });
  }
}
