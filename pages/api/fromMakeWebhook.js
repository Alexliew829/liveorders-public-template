import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '仅允许 POST 请求' });

  try {
    const { post_id, comment_id, message, user_id, user_name } = req.body;

    if (!message || !user_id || !comment_id) {
      return res.status(400).json({ error: '留言资料不完整' });
    }

    // 提取商品编号（B01、A12 等）
    const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
    if (!match) {
      return res.status(400).json({ error: '留言中未识别到有效商品编号' });
    }

    const type = match[1].toUpperCase();
    const number = match[2].padStart(3, '0');
    const selling_id = `${type}${number}`;

    // 检查是否已有同一留言写入
    const existing = await db.collection('triggered_comments').doc(comment_id).get();
    if (existing.exists) {
      return res.status(200).json({ message: '该留言已记录，无需重复' });
    }

    // 查找商品资料
    const productDoc = await db.collection('live_products').doc(selling_id).get();
    if (!productDoc.exists) {
      return res.status(404).json({ error: `商品 ${selling_id} 不存在` });
    }
    const product = productDoc.data();

    // 写入 triggered_comments（订单记录）
    await db.collection('triggered_comments').doc(comment_id).set({
      comment_id,
      message,
      user_id,
      user_name: user_name || '匿名访客',
      selling_id,
      product_name: product.product_name || '',
      price: product.price || '',
      price_raw: product.price_raw || null,
      post_id,
      created_at: new Date().toISOString()
    });

    res.status(200).json({ message: '留言订单写入成功', selling_id, user_name });

  } catch (err) {
    console.error('写入留言失败：', err);
    res.status(500).json({ error: '留言处理失败', details: err.message });
  }
}
