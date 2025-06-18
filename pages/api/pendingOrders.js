import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  try {
    const snapshot = await db
      .collection('triggered_comments')
      .where('status', '==', 'pending')
      .orderBy('created_at', 'desc')
      .limit(30)
      .get();

    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        comment_id: data.comment_id,
        selling_id: data.selling_id,
        product_name: data.product_name || '',
        price_fmt: data.price_fmt || '',
        price_raw: data.price_raw || 0,
        user_name: data.user_name || '',
        category: data.category || '',
        created_at: data.created_at?.toDate?.() || null
      };
    });

    res.status(200).json({ orders });
  } catch (err) {
    res.status(500).json({ error: '无法读取订单', detail: err.message });
  }
}
