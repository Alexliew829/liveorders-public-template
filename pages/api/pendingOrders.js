import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  try {
    // 取得所有未发连接的 triggered_comments
    const snapshot = await db
      .collection('triggered_comments')
      .orderBy('created_at', 'asc')
      .get();

    // 取得所有商品，用来判断 A/B 类
    const productsSnap = await db.collection('live_products').get();
    const productsMap = {};
    productsSnap.forEach(doc => {
      productsMap[doc.id] = doc.data(); // doc.id 是 selling_id
    });

    const userMap = new Map();
    const writtenSet = new Set(); // 用于防止 B 类商品重复处理（只处理第一位）

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.replied === true) return;

      const { user_id = 'anonymous', user_name = '匿名顾客', selling_id } = data;
      const key = user_id;

      const product = productsMap[selling_id];
      if (!product) return;

      const isA = (product.type || '').toUpperCase() === 'A';
      const uniqueKey = `${selling_id}_${user_id}`;

      if (!isA) {
        // B类：只处理第一次出现
        if (writtenSet.has(selling_id)) return;
        writtenSet.add(selling_id);
      }

      // 转换价格
      const rawPrice = typeof data.price === 'string' ? data.price.replace(/,/g, '') : data.price;
      const unitPrice = parseFloat(rawPrice) || 0;

      const item = {
        selling_id,
        product_name: data.product_name || '',
        quantity: data.quantity || 1,
        price: unitPrice,
        subtotal: unitPrice * (data.quantity || 1),
      };

      if (!userMap.has(key)) {
        userMap.set(key, {
          user_id,
          user_name,
          comment_id: data.comment_id || '',
          items: [item],
          total: item.subtotal,
        });
      } else {
        const existing = userMap.get(key);
        existing.items.push(item);
        existing.total += item.subtotal;
      }
    });

    const result = Array.from(userMap.values());
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: '读取订单失败', detail: err.message });
  }
}
