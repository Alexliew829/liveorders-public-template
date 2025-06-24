import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

function formatPrice(priceStr) {
  return parseFloat((priceStr || '').replace(/,/g, '')) || 0;
}

export default async function handler(req, res) {
  try {
    // Step 1: 读取 live_products 所有商品
    const productsSnap = await db.collection('live_products').get();
    const products = {};
    productsSnap.forEach(doc => {
      const data = doc.data();
      const id = (data.selling_id || doc.id || '').toUpperCase();
      products[id] = {
        id,
        title: data.product_name || '',
        price: formatPrice(data.price_raw || data.price || '0'),
        type: (data.type || 'B').toUpperCase(), // 默认 B 类
      };
    });

    // Step 2: 读取访客留言
    const commentsSnap = await db.collection('triggered_comments').get();
    const allOrders = [];
    const writtenB = new Set();

    commentsSnap.forEach(doc => {
      const data = doc.data();
      const sid = (data.selling_id || '').toUpperCase();
      const userId = data.user_id;
      const product = products[sid];

      if (!product) return; // 无对应商品，跳过

      // B 类只允许第一人
      if (product.type === 'B') {
        if (writtenB.has(sid)) return;
        writtenB.add(sid);
      }

      allOrders.push({
        product_id: sid,
        product_title: product.title,
        product_price: product.price,
        user_id: userId || '',
        user_name: data.user_name || '',
        comment_id: doc.id,
        post_id: data.post_id || '',
        created_time: data.created_time || '',
        paid: false,
        replied: false,
      });
    });

    // Step 3: 批次写入 orders 表
    const batch = db.batch();
    const ordersRef = db.collection('orders');
    allOrders.forEach(order => {
      batch.set(ordersRef.doc(order.comment_id), order);
    });

    await batch.commit();

    res.status(200).json({
      message: '订单写入完成',
      success: allOrders.length,
      skipped: commentsSnap.docs.length - allOrders.length,
    });

  } catch (err) {
    console.error('❌ 执行失败：', err);
    res.status(500).json({ error: '执行失败', details: err.message });
  }
}
