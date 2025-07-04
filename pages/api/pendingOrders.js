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
        subtotal
      });
      groupedByUser[uid].total += subtotal;

      // A类订单小结
      const sid = (item.selling_id || '').toUpperCase();
      if (/^A\d{1,3}$/.test(sid)) {
        if (!groupedProducts[sid]) groupedProducts[sid] = [];
        groupedProducts[sid].push({
          user_name: item.user_name || '匿名顾客',
          quantity: qty,
          product_name: item.product_name
        });
      }
    }

    const orders = Object.values(groupedByUser).map(order => {
      const itemLines = order.items.map(i =>
        `▪️ ${i.selling_id} ${i.product_name} ${i.price.toFixed(2)} x${i.quantity} = RM${i.subtotal.toFixed(2)}`
      );

      itemLines.push('',
        `总金额：RM${order.total.toFixed(2)}`,
        `SGD${(order.total / 3.25).toFixed(2)} PayLah! / PayNow me @87158951 (Siang)`,
        '',
        '付款方式：',
        'Lover Legend Adenium',
        'Maybank：512389673060',
        'Public Bank：3214928526',
        '',
        'TNG 付款连接：',
        'https://liveorders-public-template.vercel.app/TNG.jpg'
      );

      return {
        user_name: order.user_name,
        comment_id: order.comment_id,
        replied_public: order.replied_public,
        total: order.total,
        message: itemLines.join('\n')
      };
    });

    return res.status(200).json({ orders, grouped: groupedProducts });

  } catch (err) {
    console.error('❌ 读取订单失败：', err);
    return res.status(500).json({ error: '读取订单失败', details: err.message });
  }
}
