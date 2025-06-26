import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  try {
    const snapshot = await db.collection('triggered_comments').get();

    const batchSize = snapshot.size;
    if (batchSize === 0) {
      return res.status(200).json({ message: '没有旧订单需要清除。' });
    }

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    res.status(200).json({ message: `成功清除 ${batchSize} 条顾客订单记录。` });
  } catch (err) {
    console.error('[清除订单失败]', err);
    res.status(500).json({ error: '清除失败', detail: err.message });
  }
}
