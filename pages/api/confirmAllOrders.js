import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

// 强化处理：无论传入什么都能解析价格
function formatPrice(input) {
  if (typeof input === 'number') return input;
  const str = (input || '').toString();
  return parseFloat(str.replace(/,/g, '')) || 0;
}

export default async function handler(req, res) {
  try {
    const productsSnap = await db.collection('live_products').get();
    const products = {};
    productsSnap.forEach(doc => {
      const data = doc.data();
      const id = (data.selling_id || doc.id || '').toUpperCase();
      const rawPrice = data.price_raw ?? data.price ?? '0';
      const price = formatPrice(rawPrice);
      const fmtPrice = price.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      products[id] = {
        id,
        title: data.product_name || '',
        price_raw: price,
        price_fmt: fmtPrice,
        type: (data.type || 'B').toUpperCase(),
      };
    });

    const commentsSnap = await db.collection('triggered_comments').get();
    const allOrders = [];
    const writtenB = new Set();

    commentsSnap.forEach(doc => {
      const data = doc.data();
      const sid = (data.selling_id || '').toUpperCase();
      const userId = data.user_id;
      const product = products[sid];

      if (!product) return;

      // B 类只认第一位顾客
      if (product.type === 'B') {
        if (writtenB.has(sid)) return;
        writtenB.add(sid);
      }

      const order = {
        product_id: sid,
        product_title: product.title,
        product_price: product.price_raw,
        product_price_fmt: product.price_fmt,
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

    const batch = db.batch();
    const ordersRef = db.collection('orders');
    allOrders.forEach(order => {
      batch.set(ordersRef.doc(order.comment_id), order);
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
