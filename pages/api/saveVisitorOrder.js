// pages/api/saveVisitorOrder.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const ADMIN_IDS = [PAGE_ID];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const {
      message,
      from_id,
      from_name,
      comment_id,
      post_id,
      created_time
    } = req.body;

    if (!message || !from_id || !comment_id || !post_id) {
      return res.status(400).json({ error: '缺少必要字段', raw: req.body });
    }

    if (ADMIN_IDS.includes(from_id)) {
      return res.status(200).json({ skipped: true, reason: '管理员留言' });
    }

    const match = message.match(/\b[bB][\s0]*([0-9]{1,3})\b/);
    if (!match) {
      return res.status(200).json({ skipped: true, reason: '非下单格式' });
    }

    const rawId = match[1];
    const selling_id = `B${rawId.padStart(3, '0')}`;

    const existing = await db.collection('triggered_comments')
      .where('selling_id', '==', selling_id)
      .get();
    if (!existing.empty) {
      return res.status(200).json({ skipped: true, reason: '已有顾客下单' });
    }

    const productSnap = await db.collection('live_products').doc(selling_id).get();
    if (!productSnap.exists) {
      return res.status(200).json({ skipped: true, reason: '找不到商品' });
    }

    const product = productSnap.data();
    const shortId = comment_id.slice(-6);
    const payment_url = `https://pay.example.com/${selling_id}-${shortId}`;

    await db.collection('triggered_comments').doc(comment_id).set({
      selling_id,
      post_id,
      comment_id,
      user_id: from_id,
      user_name: from_name || '',
      replied: false,
      status: 'pending',
      product_name: product.product_name,
      price_fmt: product.price_fmt,
      payment_url,
      created_at: new Date(created_time || Date.now()),
    });

    return res.status(200).json({
      success: true,
      message: '顾客下单记录成功写入',
      selling_id,
      user: from_name,
    });
  } catch (err) {
    return res.status(500).json({
      error: '服务器错误',
      detail: err.message,
    });
  }
}
