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
    return res.status(405).json({ error: '仅允许 POST 请求' });
  }

  try {
    const { post_id, comment_id, message, user_id, user_name } = req.body;

    // 🛑 基本检查
    if (!message || !user_id || !comment_id) {
      return res.status(400).json({ error: '留言资料不完整' });
    }

    // 🛑 忽略主页自己留言
    if (user_id === PAGE_ID) {
      return res.status(200).json({ message: '忽略主页留言' });
    }

    // 🔍 提取商品编号（B01、a 32、B-003 等格式）
    const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
    if (!match) {
      return res.status(400).json({ error: '留言中无有效商品编号' });
    }

    const type = match[1].toUpperCase();
    const number = match[2].padStart(3, '0');
    const selling_id = `${type}${number}`;

    // 🔍 查询商品资料
    const productDoc = await db.collection('live_products').doc(selling_id).get();
    if (!productDoc.exists) {
      return res.status(404).json({ error: `找不到商品 ${selling_id}` });
    }

    const product = productDoc.data();

    // ✅ B 类商品只认第一位留言者
    if (product.type === 'B') {
      const existing = await db.collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .limit(1)
        .get();

      if (!existing.empty) {
        return res.status(200).json({ message: `商品 ${selling_id} 已被其他顾客抢先下单` });
      }
    }

    // ✅ 写入订单（用 selling_id_时间戳 作为文档 ID）
    const timestamp = Date.now();
    const docId = `${selling_id}_${timestamp}`;

    await db.collection('triggered_comments').doc(docId).set({
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

    return res.status(200).json({
      message: '留言订单写入成功',
      selling_id,
      type: product.type,
      user: user_name || '匿名访客'
    });

  } catch (err) {
    console.error('留言处理失败：', err);
    return res.status(500).json({ error: '系统错误', details: err.message });
  }
}
