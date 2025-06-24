import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  try {
    const snapshot = await db.collection('triggered_comments').get();
    const orders = [];
    snapshot.forEach(doc => {
      orders.push({ id: doc.id, ...doc.data() });
    });

    let success = 0;
    let skipped = 0;

    for (const order of orders) {
      const productId = order.selling_id;
      const productSnap = await db.collection('live_products').doc(productId).get();
      if (!productSnap.exists) {
        skipped++;
        continue;
      }

      const product = productSnap.data();
      const updateData = {
        ...order,
        product_info: product,
        confirmed_at: new Date().toISOString(),
      };

      await db.collection('confirmed_orders').doc(order.id).set(updateData);
      success++;
    }

    return res.status(200).json({
      message: '订单写入完成',
      success,
      skipped
    });
  } catch (error) {
    return res.status(500).json({
      error: '执行失败',
      details: error.message
    });
  }
}
