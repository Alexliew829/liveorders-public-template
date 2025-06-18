import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const { message, from_id, from_name, comment_id, post_id, created_time } = req.body;
    if (!message || !from_id || !comment_id || !post_id) {
      return res.status(400).json({ error: '缺少必要字段' });
    }

    // 从商品表查出匹配的商品编号
    const productsSnap = await db.collection('live_products').get();
    const products = [];
    productsSnap.forEach(doc => {
      const data = doc.data();
      products.push({ id: doc.id, ...data });
    });

    // 判断留言中有没有包含商品编号
    const lowerMsg = message.toLowerCase();
    const matched = products.find(p => {
      const pattern = new RegExp(`\\b${p.selling_id.replace(/\s+/g, '').toLowerCase()}\\b`);
      return pattern.test(lowerMsg);
    });

    if (!matched) {
      return res.status(200).json({ success: false, message: '未匹配到任何商品编号' });
    }

    const { selling_id, product_name, price, type = 'B' } = matched;
    const price_fmt = Number(price).toLocaleString('en-MY', { minimumFractionDigits: 2 });

    const orderRef = db.collection('visitor_orders');

    if (type === 'B') {
      // 限购一次，只写入第一个订单
      const existing = await orderRef.where('selling_id', '==', selling_id).limit(1).get();
      if (!existing.empty) {
        return res.status(200).json({ success: false, message: 'B类商品已有订单' });
      }
    }

    if (type === 'A') {
      // 同一顾客不能重复下单相同商品
      const duplicate = await orderRef
        .where('selling_id', '==', selling_id)
        .where('user_id', '==', from_id)
        .limit(1)
        .get();
      if (!duplicate.empty) {
        return res.status(200).json({ success: false, message: 'A类重复下单' });
      }
    }

    // 写入订单
    await orderRef.add({
      selling_id,
      product_name,
      price,
      price_fmt,
      user_id: from_id,
      user_name: from_name || '',
      comment_id,
      post_id,
      created_time,
      replied: false
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[写入订单失败]', err);
    return res.status(500).json({ error: '写入失败', detail: err.message });
  }
}
