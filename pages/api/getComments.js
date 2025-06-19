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
      .orderBy('created_at', 'desc')
      .limit(20)
      .get();

    const comments = snapshot.docs.map(doc => doc.data());
    return res.status(200).json(comments);
  } catch (err) {
    console.error('读取失败:', err);
    return res.status(500).json({ error: '读取失败' });
  }
}
