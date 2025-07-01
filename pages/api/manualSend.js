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
  const comment_id = req.body.comment_id || req.query.comment_id;
  if (!comment_id) return res.status(400).json({ error: '缺少 comment_id 参数' });

  try {
    const commentSnap = await db.collection('triggered_comments').doc(comment_id).get();
    if (!commentSnap.exists) return res.status(404).json({ error: '找不到该留言记录' });

    const { user_name, user_id } = commentSnap.data();

    // 获取该用户所有下单商品
    const orderSnap = await db.collection('triggered_comments')
      .where('user_id', '==', user_id)
      .get();

    let total = 0;
    let productLines = [];

    orderSnap.forEach(doc => {
      const data = doc.data();
      const { selling_id, product_name, price, quantity } = data;
      const unitPrice = parseFloat(price) || 0;
      const qty = parseInt(quantity) || 1;
      const subtotal = unitPrice * qty;
      total += subtotal;

      productLines.push(`▪️ ${selling_id} ${product_name} RM${unitPrice.toFixed(2)} x${qty} = RM${subtotal.toFixed(2)}`);
    });

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

    // 更新 replied 状态
    await db.collection('triggered_comments').doc(comment_id).update({ replied: true });

    return res.status(200).json({ success: true, total: total.toFixed(2), fbRes });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
