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

  const { message, from_id, from_name, comment_id, post_id, created_time } = req.body || {};
  if (!message || !from_id || !comment_id || !post_id) {
    return res.status(400).json({ error: '缺少必要字段' });
  }

  try {
    const productsRef = db.collection('live_products');
    const snapshot = await productsRef.where('post_id', '==', post_id).get();
    if (snapshot.empty) {
      return res.status(404).json({ error: '未找到商品数据' });
    }

    const productList = [];
    snapshot.forEach(doc => {
      const item = doc.data();
      const id = item.selling_id?.toLowerCase().replace(/\s+/g, '');
      if (id) {
        productList.push({ ...item, id });
      }
    });

    const messageText = message.toLowerCase().replace(/\s+/g, '');
    const matched = productList.find(p => messageText.includes(p.id));

    if (!matched) {
      return res.status(200).json({ success: false, reason: '留言中无商品编号' });
    }

    const ordersRef = db.collection('orders');

    if (matched.category === 'B') {
      const bQuery = await ordersRef
        .where('selling_id', '==', matched.selling_id)
        .limit(1)
        .get();
      if (!bQuery.empty) {
        return res.status(200).json({ success: false, reason: 'B类商品已被抢先下单' });
      }
    }

    if (matched.category === 'A') {
      const aQuery = await ordersRef
        .where('selling_id', '==', matched.selling_id)
        .where('user_id', '==', from_id)
        .limit(1)
        .get();
      if (!aQuery.empty) {
        return res.status(200).json({ success: false, reason: '同一顾客已下单该 A 类商品' });
      }
    }

    const price_raw = Number(matched.price || 0);
    const price_fmt = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

    await ordersRef.add({
      comment_id,
      post_id,
      user_id: from_id,
      user_name: from_name || '',
      selling_id: matched.selling_id,
      product_name: matched.product_name || '',
      category: matched.category || '',
      price: price_raw,
      price_fmt,
      created_time,
      replied: false,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('写入订单失败:', err);
    return res.status(500).json({ error: '写入订单失败', detail: err.message });
  }
}
