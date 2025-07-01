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
  if (!comment_id) return res.status(400).json({ error: '缺少 comment_id 参数' });

  try {
    // 获取该留言记录
    const commentSnap = await db.collection('triggered_comments').doc(comment_id).get();
    if (!commentSnap.exists) return res.status(404).json({ error: '找不到该留言记录' });

    const { user_name, user_id } = commentSnap.data();

    // 获取该用户所有订单
    const orderSnap = await db.collection('triggered_comments')
      .where('user_id', '==', user_id)
      .get();

    let total = 0;
    let productLines = [];

    for (const doc of orderSnap.docs) {
      const { selling_id, product_name, quantity } = doc.data();

      // 读取最新价格（从 live_products）
      const productDoc = await db.collection('live_products').doc(selling_id).get();
      const productData = productDoc.exists ? productDoc.data() : null;

      if (!productData) continue;

      const price = parseFloat(productData.price_raw || 0);
      const qty = parseInt(quantity);
      const subtotal = price * qty;
      total += subtotal;

      productLines.push(`▪️ ${selling_id} ${product_name} x${qty} = RM${subtotal.toFixed(2)}`);
    }

    const totalStr = `总金额：RM${total.toFixed(2)}`;
    const paymentMessage = [
      `感谢下单 ${user_name} 🙏`,
      ...productLines,
      totalStr,
      `付款方式：`,
      `Maybank：512389673060`,
      `Public Bank：3214928526`,
      `TNG 电子钱包付款链接：`,
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

    // 更新状态为已发连接
    await db.collection('triggered_comments').doc(comment_id).update({ replied: true });

    return res.status(200).json({ success: true, total: total.toFixed(2), fbRes });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
