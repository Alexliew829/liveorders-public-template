// pages/api/pendingOrders.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

function formatCurrency(amount) {
  return parseFloat(amount).toLocaleString('en-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  });
}

export default async function handler(req, res) {
  try {
    const snapshot = await db
      .collection('triggered_comments')
      .where('replied', '==', false)
      .orderBy('created_at', 'asc')
      .get();

    const groups = {};

    snapshot.forEach(doc => {
      const data = doc.data();
      const userId = data.user_id || 'anonymous';
      const userName = data.user_name || '匿名用户';

      if (!groups[userId]) {
        groups[userId] = {
          user_id: userId,
          user_name: userName,
          orders: [],
          total: 0,
          first_comment_id: data.comment_id,
        };
      }

      const quantity = parseInt(data.quantity || 1);
      const unitPrice = parseFloat(data.price || 0);
      const subtotal = unitPrice * quantity;

      groups[userId].orders.push({
        selling_id: data.selling_id,
        product_name: data.product_name,
        quantity,
        price: unitPrice.toFixed(2),
        subtotal: subtotal.toFixed(2),
      });

      groups[userId].total += subtotal;
    });

    const result = Object.values(groups).map(group => ({
      user_id: group.user_id,
      user_name: group.user_name,
      orders: group.orders,
      total_amount: formatCurrency(group.total),
      first_comment_id: group.first_comment_id,
    }));

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
