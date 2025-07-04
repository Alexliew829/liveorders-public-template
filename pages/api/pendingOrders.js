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

      const sidRaw = item.selling_id || '';
      const normalizedSID = sidRaw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(); // 例如 A032、a 32、A-032

      const qty = parseInt(item.quantity) || 1;
      const price = parseFloat(item.price) || 0;
      const subtotal = qty * price;

      // 若字段缺失，跳过该留言
      if (!item.product_name || isNaN(price) || !normalizedSID) {
        console.warn('⚠️ 跳过不完整留言：', item);
        continue;
      }

      if (!groupedByUser[uid]) {
        groupedByUser[uid] = {
          user_name: item.user_name || '匿名顾客',
          comment_id: item.comment_id,
          replied_public: item.replied_public || false,
          items: [],
          total: 0
        };
      }

      groupedByUser[uid].items.push({
        selling_id: normalizedSID,
        product_name: item.product_name,
        quantity: qty,
        price,
        subtotal
      });

      if (!isNaN(subtotal)) {
        groupedByUser[uid].total += subtotal;
      }

      // ✅ 识别 A 类编号
      if (/^A\d{1,3}$/.test(normalizedSID)) {
        if (!groupedProducts[normalizedSID]) {
          groupedProducts[normalizedSID] = [];
        }
        groupedProducts[normalizedSID].push({
          user_name: item.user_name || '匿名顾客',
          quantity: qty
        });
      }
    }

    const orders = Object.values(groupedByUser).map(order => ({
      user_name: order.user_name,
      comment_id: order.comment_id,
      replied_public: order.replied_public,
      total: order.total,
      message: order.items.map(i =>
        `▪️ ${i.selling_id} ${i.product_name} x${i.quantity} = RM${(i.subtotal).toFixed(2)}`
      ).join('\n')
    }));

    console.log('✅ 输出订单总数:', orders.length, 'A类商品种类:', Object.keys(groupedProducts).length);

    return res.status(200).json({ orders, grouped: groupedProducts });

  } catch (err) {
    console.error('❌ 读取订单失败：', err);
    return res.status(500).json({ error: '读取订单失败', details: err.message });
  }
}
