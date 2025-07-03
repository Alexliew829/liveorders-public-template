import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  const { comment_id, channel = 'comment' } =
    req.method === 'POST' ? req.body : req.query;

  if (!comment_id) {
    return res.status(400).json({ error: '缺少 comment_id 参数' });
  }

  try {
    // 查找该顾客的订单留言
    const querySnap = await db
      .collection('triggered_comments')
      .where('comment_id', '==', comment_id)
      .limit(1)
      .get();

    if (querySnap.empty) {
      return res.status(404).json({ error: '找不到该留言记录' });
    }

    const commentSnap = querySnap.docs[0];
    const { user_name, user_id } = commentSnap.data();

    // 查找此顾客的所有订单
    const orderSnap = await db
      .collection('triggered_comments')
      .where('user_id', '==', user_id)
      .get();

    let total = 0;

    for (const doc of orderSnap.docs) {
      const { selling_id, quantity } = doc.data();
      const productDoc = await db.collection('live_products').doc(selling_id).get();
      if (!productDoc.exists) continue;

      const { price } = productDoc.data();
      const unitPrice = parseFloat(typeof price === 'string' ? price.replace(/,/g, '') : price);
      const qty = parseInt(quantity) || 1;
      const subtotal = +(unitPrice * qty).toFixed(2);
      total += subtotal;
    }

    total = +total.toFixed(2);

    // 发送留言：只显示通知（不再公开订单详情）
    const notifyMessage = `感谢 ${user_name || '顾客'}，你的订单详情已经发送到 Inbox 👉 https://m.me/lover.legend.gardening，请查阅 📥`;

    const url = `https://graph.facebook.com/${comment_id}/comments`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: notifyMessage,
        access_token: PAGE_TOKEN
      })
    });

    const fbRes = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: '发送失败', fbRes });
    }

    await commentSnap.ref.update({ replied: true });

    return res.status(200).json({ success: true, total: total.toFixed(2), fbRes });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
