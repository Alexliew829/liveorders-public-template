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
    const { post_id, comment_id, message, user_id, user_name, force } = req.body;
    const isForce = force === true || force === 'true';

    // 基本校验
    if (!post_id || !comment_id || !message) {
      return res.status(400).json({ error: '缺少必要字段：post_id / comment_id / message' });
    }

    // 排除主页留言
    if (user_id === PAGE_ID) {
      return res.status(200).json({ message: '已忽略主页留言' });
    }

    // 提取商品编号（如 A32、b_032、A-88 等）
    const match = message.match(/[aAbB][\s\-_.～]*0{0,2}(\d{1,3})/);
    if (!match) {
      return res.status(200).json({ message: '无有效商品编号，跳过处理' });
    }

    const prefix = match[0][0].toUpperCase();  // A or B
    const number = match[1].padStart(3, '0');  // 标准化为三位数
    const selling_id = `${prefix}${number}`;

    // 提取数量（如 A32-5 / A66－888），默认 1
    let quantity = 1;
    const qtyMatch = message.match(/[－\-–]\s*(\d{1,3})\b/);
    if (qtyMatch) {
      const parsedQty = parseInt(qtyMatch[1]);
      if (!isNaN(parsedQty) && parsedQty > 0) {
        quantity = parsedQty;
      }
    }

    // 查询商品是否存在于 live_products
    const productRef = db.collection('live_products').doc(selling_id);
    const productSnap = await productRef.get();
    if (!productSnap.exists) {
      return res.status(200).json({ message: `编号 ${selling_id} 不存在于商品列表中，跳过处理` });
    }

    const product = productSnap.data();

    // ✅ 修改：清洗 price 字段为纯数字（防止含逗号或字符串）
    const cleanPrice = typeof product.price === 'string'
      ? parseFloat(product.price.replace(/,/g, ''))
      : product.price || 0;

    // 准备写入 payload
    const payload = {
      post_id,
      comment_id,
      message,
      user_id: user_id || '',
      user_name: user_name || '',
      created_at: Date.now(),
      replied: false,
      selling_id,
      product_name: product.product_name || '',
      price: cleanPrice,
      quantity
    };

    if (prefix === 'B') {
      // B 类商品只允许第一人留言，且数量强制为 1
      const docRef = db.collection('triggered_comments').doc(selling_id);
      if (!isForce) {
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          return res.status(200).json({ message: `编号 ${selling_id} 已被抢购（B 类限一人）` });
        }
      }
      await docRef.set({ ...payload, quantity: 1 });
      return res.status(200).json({ message: '✅ B 类下单成功', doc_id: selling_id });

    } else {
      // A 类商品允许多人留言，支持数量提取
      const docId = `${selling_id}_${comment_id}`;
      if (!isForce) {
        const existing = await db.collection('triggered_comments').doc(docId).get();
        if (existing.exists) {
          return res.status(200).json({ message: 'A 类订单已存在，跳过' });
        }
      }
      await db.collection('triggered_comments').doc(docId).set(payload);
      return res.status(200).json({ message: '✅ A 类下单成功', doc_id: docId });
    }

  } catch (err) {
    return res.status(500).json({ error: '❌ 系统错误，写入失败', details: err.message });
  }
}
