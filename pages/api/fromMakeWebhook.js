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

    // ✅ 宽容提取编号（A 或 B + 1~3位数字），允许中间有空格、0填充、大小写混合
    const match = message.match(/\b([ab])\s*0*([1-9][0-9]{0,2})\b/i);
    if (!match) {
      return res.status(200).json({ status: 'ignored', reason: '留言中没有有效编号' });
    }
    const type = match[1].toUpperCase(); // A 或 B
    const number = match[2];             // 去除前导0的编号
    const selling_id = type + number;    // A32、B001 等标准格式

    // 🔍 查找商品
    const productSnap = await db.collection('live_products').doc(selling_id).get();
    if (!productSnap.exists) {
      return res.status(200).json({ status: 'failed', reason: `找不到商品 ${selling_id}` });
    }
    const product = productSnap.data();

    // ✅ B 类商品只写入第一位留言者
    if (product.type === 'B') {
      const existSnap = await db.collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .limit(1)
        .get();
      if (!existSnap.empty) {
        return res.status(200).json({ status: 'skipped', reason: 'B类商品已有下单者' });
      }
    }

    // ✅ 写入 Firestore（跳过 undefined）
    await db.collection('triggered_comments').doc(comment_id).set({
      comment_id,
      post_id: post_id || '',
      message,
      user_id: user_id || '',
      user_name: user_name || '匿名用户',
      selling_id,
      product_name: product?.product_name || '',
      price: product?.price || '',
      price_raw: product?.price_raw || 0,
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({ status: 'success', selling_id });
  } catch (err) {
    console.error('❌ 处理留言失败：', err);
    return res.status(500).json({ error: '内部错误', details: err.message });
  }
}
