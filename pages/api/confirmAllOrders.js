import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const commentsSnap = await db.collection('triggered_comments').get();
    const productSnap = await db.collection('live_products').get();

    const productsMap = {};
    productSnap.forEach(doc => {
      const data = doc.data();
      productsMap[data.selling_id?.toUpperCase()?.replace(/\s+/g, '')] = data;
    });

    let successCount = 0;
    let skipCount = 0;

    for (const commentDoc of commentsSnap.docs) {
      const commentData = commentDoc.data();
      const selling_id_raw = commentData.selling_id || '';
      const orderId = selling_id_raw.toUpperCase().replace(/\s+/g, '');

      const existing = await db.collection('orders').doc(orderId).get();
      if (existing.exists) {
        skipCount++;
        continue;
      }

      const matchedProduct = productsMap[orderId];
      if (!matchedProduct) {
        skipCount++;
        continue;
      }

      const order = {
        comment_id: commentData.comment_id,
        user_id: commentData.user_id || '',
        user_name: commentData.user_name || '',
        selling_id: matchedProduct.selling_id,
        product_name: matchedProduct.product_name,
        price: matchedProduct.price,
        price_fmt: matchedProduct.price_fmt,
        created_time: new Date().toISOString(),
        payment_url: '', // 待发送
        replied: false
      };

      await db.collection('orders').doc(orderId).set(order);
      successCount++;
    }

    res.status(200).json({
      message: '订单写入完成',
      success: successCount,
      skipped: skipCount
    });
  } catch (err) {
    res.status(500).json({ error: '写入失败', details: err.message });
  }
}
