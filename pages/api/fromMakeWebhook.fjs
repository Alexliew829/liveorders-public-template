import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  const { post_id, comment_id, message, user_id, user_name } = req.body;

  if (!post_id || !comment_id || !message) {
    return res.status(400).json({ error: '缺少必要字段', body: req.body });
  }

  // 忽略主页自己留言
  if (user_id === PAGE_ID) {
    return res.status(200).json({ status: '跳过主页留言' });
  }

  // 提取编号（如 B001 / A32 等）
  const match = message.match(/\b([AB])[\s\-]?0*(\d{1,3})\b/i);
  if (!match) {
    return res.status(200).json({ status: '无有效编号，跳过' });
  }

  const type = match[1].toUpperCase();  // A 或 B
  const number = match[2].padStart(3, '0'); // 001, 032
  const selling_id = `${type}${number}`;

  // 查询商品资料
  const productRef = db.collection('live_products').doc(selling_id);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    return res.status(404).json({ error: `找不到商品 ${selling_id}` });
  }
  const product = productSnap.data();

  const commentRef = db.collection('triggered_comments').doc(comment_id);

  if (type === 'B') {
    // 只允许第一个留言者写入
    const existing = await db.collection('triggered_comments')
      .where('selling_id', '==', selling_id)
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.status(200).json({ status: `B类商品 ${selling_id} 已被留言，不重复写入` });
    }
  }

  // 写入 Firestore
  await commentRef.set({
    post_id,
    comment_id,
    message,
    user_id,
    user_name: user_name || '',
    selling_id,
    type,
    created_at: new Date().toISOString(),
    product_name: product.product_name,
    price: product.price,
    price_raw: product.price_raw,
  });

  return res.status(200).json({ status: `成功写入 ${selling_id}` });
}
