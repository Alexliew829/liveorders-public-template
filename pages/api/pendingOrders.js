import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  try {
    // 读取全部未发送的订单
    const snapshot = await db
      .collection('triggered_comments')
      .where('replied', '==', false)
      .orderBy('created_at', 'asc')
      .get();

    const allOrders = [];
    snapshot.forEach(doc => allOrders.push(doc.data()));

    const result = [];
    const aCounts = {}; // A类商品下单计数
    const bSeen = new Set(); // B类商品只记录第一个

    for (const data of allOrders) {
      const selling_id = data.selling_id || '';
      const isA = selling_id.trim().toUpperCase().startsWith('A');
      const isB = selling_id.trim().toUpperCase().startsWith('B');

      if (isA) {
        const count = aCounts[selling_id] || 0;
        const limit = parseInt(data.quantity || 1);
        if (count < limit) {
          aCounts[selling_id] = count + 1;
          result.push({
            comment_id: data.comment_id,
            user_name: data.user_name || '',
            selling_id: data.selling_id,
            product_name: data.product_name,
            quantity: data.quantity || 1,
            price: data.price || '',
            price_fmt: data.price_fmt || '',
            payment_url: data.payment_url || '',
          });
        }
      } else if (isB && !bSeen.has(selling_id)) {
        bSeen.add(selling_id);
        result.push({
          comment_id: data.comment_id,
          user_name: data.user_name || '',
          selling_id: data.selling_id,
          product_name: data.product_name,
          quantity: data.quantity || 1,
          price: data.price || '',
          price_fmt: data.price_fmt || '',
          payment_url: data.payment_url || '',
        });
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
