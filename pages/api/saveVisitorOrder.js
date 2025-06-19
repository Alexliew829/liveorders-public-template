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
    // 若是新直播，删除旧订单
    const lastProductSnapshot = await db.collection('live_products').where('post_id', '!=', post_id).limit(1).get();
    if (!lastProductSnapshot.empty) {
      const deleteLive = await db.collection('live_products').listDocuments();
      const deleteOrders = await db.collection('orders').listDocuments();
      await Promise.all([
        ...deleteLive.map(doc => doc.delete()),
        ...deleteOrders.map(doc => doc.delete())
      ]);
    }

    // 获取商品清单
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
      // B 类商品只接受一个订单
      const bQuery = await ordersRef
        .where('selling_id', '==', matched.selling_id)
        .limit(1)
        .get();
      if (!bQuery.empty) {
        return res.status(200).json({ success: false, reason: 'B类商品已被抢先下单' });
      }
    }

    if (matched.category === 'A') {
      // A 类商品允许多个顾客下单（但同一顾客不能重复）
      const aQuery = await ordersRef
        .where('selling_id', '==', matched.selling_id)
        .where('user_id', '==', from_id)
        .limit(1)
        .get();
      if (!aQuery.empty) {
        return res.status(200).json({ success: false, reason: '该顾客已下单此A类商品' });
      }
    }

    const price_fmt = Number(matched.price || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 });

    await ordersRef.add({
      comment_id,
      post_id,
      user_id: from_id,
      user_name: from_name || '',
      selling_id: matched.selling_id,
      product_name: matched.product_name || '',
      category: matched.category || '',
      price: matched.price || 0,
      price_fmt,
      created_time,
      replied: false,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('识别订单失败:', err);
    return res.status(500).json({ error: '识别订单失败', detail: err.message });
  }
}
