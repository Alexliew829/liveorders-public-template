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
    const body = req.body;
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const comment = change?.value;

    if (!comment || comment.verb !== 'add' || !comment.message) {
      return res.status(200).json({ message: '无效留言，忽略' });
    }

    const { post_id, comment_id, created_time, from, message } = comment;
    if (!from || from.id === PAGE_ID) {
      return res.status(200).json({ message: '跳过主页留言' });
    }

    const cleanMessage = message.toUpperCase().replace(/\s+/g, '');
    const match = cleanMessage.match(/\b([AB])(\d{1,4})\b/);
    if (!match) {
      return res.status(200).json({ message: '无有效编号，跳过' });
    }

    const prefix = match[1];
    const number = match[2].padStart(3, '0');
    const selling_id = `${prefix}${number}`;

    const productSnap = await db.collection('live_products').doc(selling_id).get();
    if (!productSnap.exists) {
      return res.status(200).json({ message: `编号 ${selling_id} 不存在于产品表` });
    }

    const product = productSnap.data();
    const isB = product.category === 'B';

    if (isB) {
      const existing = await db
        .collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .get();
      if (!existing.empty) {
        return res.status(200).json({ message: `B 类商品 ${selling_id} 已有留言者，跳过` });
      }
    }

    await db.collection('triggered_comments').add({
      comment_id,
      post_id,
      created_at: new Date().toISOString(),
      selling_id,
      category: product.category,
      product_name: product.product_name || '',
      price: product.price || 0,
      price_fmt: product.price_fmt || '',
      replied: false,
      user_id: from.id,
      user_name: from.name || '',
    });

    return res.status(200).json({ message: `✅ 已记录访客留言 ${selling_id}` });
  } catch (err) {
    console.error('❌ Webhook 错误:', err);
    return res.status(500).json({ error: 'Webhook 处理失败', detail: err.message });
  }
}
