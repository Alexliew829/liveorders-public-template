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
  const comment_id = req.query.comment_id;
  const debug = req.query.debug !== undefined;

  if (!comment_id) {
    return res.status(400).json({ error: '缺少 comment_id 参数' });
  }

  try {
    const commentSnap = await db.collection('triggered_comments').doc(comment_id).get();
    if (!commentSnap.exists) {
      return res.status(404).json({ error: '找不到该留言记录' });
    }

    const { user_name, user_id, selling_id } = commentSnap.data();

    const orderSnap = await db.collection('triggered_comments')
      .where('user_id', '==', user_id)
      .get();

    let total = 0;
    let productLines = [];
    let debugLines = [];

    for (const doc of orderSnap.docs) {
      const data = doc.data();
      const { selling_id, product_name, price, quantity } = data;

      const unit = parseFloat(price);
      const qty = parseInt(quantity);
      const subtotal = unit * qty;
      total += subtotal;

      productLines.push(`▪️ ${selling_id} ${product_name} RM${unit.toFixed(2)} x${qty} = RM${subtotal.toFixed(2)}`);
      debugLines.push({ selling_id, product_name, unit, qty, subtotal });
    }

    const totalStr = `总金额：RM${total.toFixed(2)}`;
    const paymentMessage = [
      `感谢下单 ${user_name} 🙏`,
      ...productLines,
      totalStr,
      `付款方式：`,
      `Maybank：512389673060`,
      `Public Bank：3214928526`,
      `TNG电子钱包：`,
      `https://payment.tngdigital.com.my/sc/dRacq2iFOb`
    ].join('\n');

    if (debug) {
      return res.status(200).json({
        user: user_name,
        comment_id,
        orders: debugLines,
        total: total.toFixed(2)
      });
    }

    // 发出留言回复
    const url = `https://graph.facebook.com/${comment_id}/comments`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: paymentMessage,
        access_token: PAGE_TOKEN
      })
    });

    const fbRes = await r.json();
    if (!r.ok) return res.status(500).json({ error: '发送失败', fbRes });

    await db.collection('triggered_comments').doc(comment_id).update({ replied: true });

    return res.status(200).json({ success: true, total: total.toFixed(2), fbRes });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
