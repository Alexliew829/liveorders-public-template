import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  const { selling_id } = req.query;
  if (!selling_id) {
    return res.status(400).json({ error: '缺少 selling_id 参数' });
  }

  try {
    const snapshot = await db
      .collection('triggered_comments')
      .where('selling_id', '==', selling_id)
      .orderBy('created_at', 'asc')
      .get();

    const results = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      results.push({
        user_name: data.user_name || '匿名顾客',
        selling_id: data.selling_id,
        product_name: data.product_name,
        quantity: data.quantity || 1
      });
    }

    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: '读取失败', details: err.message });
  }
}
