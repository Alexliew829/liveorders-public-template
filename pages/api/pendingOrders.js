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
      return res.status(200).json({ orders: [], grouped: {} });
    }

    const rawOrders = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      rawOrders.push({ id: doc.id, ...data });
    });

    const groupedByUser = {};
    const groupedProducts = {};

    for (const item of rawOrders) {
      const uid = item.user_id || item.user_name || item.comment_id;
      if (!groupedByUser[uid]) {
        groupedByUser[uid] = {
          user_name: item.user_name || '匿名顾客',
          comment_id: item.comment_id,
          replied_public: item.replied_public || false,
          items: [],
          total: 0
        };
      }

      const qty = item.quantity || 1;
      const price = item.price || 0;
      const subtotal = qty * price;

      groupedByUser[uid].items.push({
        selling_id: item.selling_id,
        product_name: item.product_name,
        quantity: qty,
        price,
        subtotal,
        message: item.message || null  // ✅ 加入原始留言 message（如 "A32 +10"）
      });

      groupedByUser[uid].total += subtotal;

      // ✅ A类订单小结
      const sid = (item.selling_id || '').toUpperCase();
      if (/^A\d{1,3}$/.test(sid)) {
        if (!groupedProducts[sid]) groupedProducts[sid] = [];
        groupedProducts[sid].push({
          user_name: item.user_name || '匿名顾客',
          quantity: qty
        });
      }
    }

    // ✅ 展开为每一笔订单（为配合前端 message 显示）
    const orders = [];

    for (const order of Object.values(groupedByUser)) {
      for (const item of order.items) {
        orders.push({
          user_name: order.user_name,
          comment_id: order.comment_id,
          replied_public: order.replied_public,
          total: order.total,
          message: item.message || `▪️ ${item.selling_id} ${item.product_name} x${item.quantity} = RM${item.subtotal.toFixed(2)}`
        });
      }
    }

    return res.status(200).json({ orders, grouped: groupedProducts });

  } catch (err) {
    console.error('❌ 读取订单失败：', err);
    return res.status(500).json({ error: '读取订单失败', details: err.message });
  }
}
