import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  try {
    const productsSnap = await db.collection('live_products').get();
    const products = {};
    productsSnap.forEach(doc => {
      const data = doc.data();
      products[doc.id.toUpperCase()] = { ...data, id: doc.id.toUpperCase() };
    });

    const commentsSnap = await db.collection('triggered_comments').get();
    const allOrders = [];
    const writtenIds = new Set();

    commentsSnap.forEach(doc => {
      const data = doc.data();
      const sid = data.selling_id?.toUpperCase();
      const userId = data.user_id;

      const product = products[sid];
      if (!product) return; // 商品不存在

      // B类：只认第一位留言者，避免重复
      if (product.type === 'B') {
        if (writtenIds.has(sid)) return;
        writtenIds.add(sid);
      }

      const order = {
        product_id: sid,
        product_title: product.title || '',
        product_price: product.price || 0,
        user_id: userId || '',
        user_name: data.user_name || '',
        comment_id: doc.id,
        post_id: data.post_id || '',
        created_time: data.created_time || '',
        paid: false,
        replied: false,
      };

      allOrders.push(order);
    });

    // 写入 orders
    const batch = db.batch();
    const ordersRef = db.collection('orders');
    allOrders.forEach(order => {
      const newDoc = ordersRef.doc(order.comment_id);
      batch.set(newDoc, order);
    });

    await batch.commit();

    res.status(200).json({
      message: '订单写入完成',
      success: allOrders.length,
      skipped: commentsSnap.size - allOrders.length,
    });
  } catch (err) {
    res.status(500).json({ error: '执行失败', details: err.message });
  }
}
