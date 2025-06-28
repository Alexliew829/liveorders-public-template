import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const PAGE_ID = process.env.PAGE_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: '只允许 POST' });

  try {
    const { post_id, comment_id, message, user_id, user_name } = req.body;

    console.log('📥 Webhook 收到留言内容：', JSON.stringify(req.body, null, 2));

    if (!message || !comment_id) {
      return res.status(400).json({ error: '缺少 comment_id 或 message' });
    }

    // 排除主页自己的留言
    if (user_id && user_id === PAGE_ID) {
      return res.status(200).json({ status: 'ignored', reason: '主页留言' });
    }

    // ✅ 支持 A / B 编号（如 A101、B222、a 01、b001）
    const match = message.match(/([ab])\s*0*([1-9][0-9]{0,2})/i);
    if (!match) {
      return res.status(200).json({ status: 'ignored', reason: '留言中没有商品编号' });
    }
    const prefix = match[1].toUpperCase(); // A 或 B
    const selling_id = prefix + match[2];

    // 查找对应商品
    const productSnap = await db.collection('live_products').doc(selling_id).get();
    if (!productSnap.exists) {
      return res.status(200).json({ status: 'failed', reason: `找不到商品 ${selling_id}` });
    }
    const product = productSnap.data();

    // ✅ 若为 B 类商品，只允许第一位顾客
    if (product.type === 'B') {
      const existSnap = await db.collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .limit(1)
        .get();
      if (!existSnap.empty) {
        return res.status(200).json({ status: 'skipped', reason: '已有下单者' });
      }
    }

    // ✅ 写入 Firestore
    await db.collection('triggered_comments').doc(comment_id).set({
      comment_id,
      post_id: post_id || '',
      message,
      user_id: user_id || '',
      user_name: user_name || '匿名用户',
      selling_id,
      product_name: product.name,
      price: product.price,
      price_raw: product.price_raw,
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({ status: 'success', selling_id });
  } catch (err) {
    console.error('❌ 处理留言失败：', err);
    return res.status(500).json({ error: '内部错误', details: err.message });
  }
}
