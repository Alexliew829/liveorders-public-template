import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// 标准化编号函数，例如 "a 32" → "A032"
function normalizeSellingId(raw) {
  const match = raw.match(/[a-zA-Z]\s*0*(\d{1,3})/);
  if (!match) return raw;
  const letter = raw.match(/[a-zA-Z]/)[0].toUpperCase();
  const num = match[1].padStart(3, '0');
  return `${letter}${num}`;
}

export default async function handler(req, res) {
  const { selling_id } = req.query;
  if (!selling_id) {
    return res.status(400).json({ error: '缺少 selling_id 参数' });
  }

  const normalizedId = normalizeSellingId(selling_id);

  try {
    let query = db
      .collection('triggered_comments')
      .where('selling_id', '==', normalizedId);

    // 尝试加排序（如果没有索引，不影响主逻辑）
    try {
      query = query.orderBy('created_at', 'asc');
    } catch (e) {
      console.warn('未建立索引，跳过排序 created_at');
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
