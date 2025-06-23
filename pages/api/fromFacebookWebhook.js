import { initializeApp, cert, getApps } from 'firebase-admin/app';
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

  try {
    const { message = '', from = {}, comment_id, post_id, created_time } = req.body;

    if (!from || from.id === PAGE_ID) {
      return res.status(200).json({ skip: '跳过主页留言' });
    }

    const user_id = from.id;
    const user_name = from.name || '匿名用户';

    const normalized = message.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = normalized.match(/^([AB])0*(\d{1,3})$/);
    if (!match) {
      return res.status(200).json({ skip: '不是有效商品编号', original: message });
    }

    const category = match[1];
    const number = match[2].padStart(3, '0');
    const selling_id = category + number;

    const productRef = db.collection('live_products').doc(selling_id);
    const productSnap = await productRef.get();
    if (!productSnap.exists) {
      return res.status(200).json({ skip: `商品 ${selling_id} 不存在` });
    }

    const product = productSnap.data();

    if (product.category === 'B') {
      const existing = await db.collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .limit(1)
        .get();
      if (!existing.empty) {
        return res.status(200).json({ skip: `B 类商品 ${selling_id} 已被抢单` });
      }
    }

    await db.collection('triggered_comments').doc(comment_id).set({
      user_id,
      user_name,
      comment_id,
      post_id,
      created_time,
      selling_id,
      category,
      product_name: product.product_name,
      price: product.price,
      price_fmt: product.price_fmt,
      replied: false,
      status: 'pending',
      sent_at: ''
    });

    return res.status(200).json({ success: true, selling_id });
  } catch (err) {
    console.error('❌ 写入 triggered_comments 失败', err);
    return res.status(500).json({ error: '处理失败', detail: err.message });
  }
}
