import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  const sidRaw = req.query.selling_id || '';
  const match = sidRaw.match(/[a-zA-Z]\s*0*(\d{1,3})/);
  if (!match) {
    return res.status(400).json({ error: '无效编号格式' });
  }

  const letter = sidRaw.match(/[a-zA-Z]/)[0].toUpperCase();
  const number = match[1].padStart(3, '0');
  const normalizedSID = `${letter}${number}`;

  try {
    const snapshot = await db.collection('triggered_comments')
      .where('replied', '==', false)
      .where('selling_id', '>=', normalizedSID)
      .where('selling_id', '<=', normalizedSID + '\uf8ff')
      .get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const result = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (
        data.selling_id &&
        data.selling_id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === normalizedSID
      ) {
        result.push({
          user_name: data.user_name || '匿名顾客',
          selling_id: normalizedSID,
          product_name: data.product_name || '',
          quantity: parseInt(data.quantity) || 1
        });
      }
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('❌ 获取产品订单失败：', err);
    return res.status(500).json({ error: '读取失败', details: err.message });
  }
}
