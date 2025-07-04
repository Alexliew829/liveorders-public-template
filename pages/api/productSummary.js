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
    // 默认不排序，避免无索引时报错
    let query = db
      .collection('triggered_comments')
      .where('selling_id', '==', selling_id);

    // 尝试加排序，如果没有建立索引则略过
    try {
      query = query.orderBy('created_at', 'asc');
    } catch (e) {
      console.warn('未建立索引，已跳过排序 created_at');
    }

    const snapshot = await query.get();

    const results = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        user_name: data.user_name || '匿名顾客',
        selling_id: data.selling_id,
        product_name: data.product_name,
        quantity: data.quantity || 1
      };
    });

    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: '读取失败', details: err.message });
  }
}
