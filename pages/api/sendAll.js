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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  const { channel = 'comment' } = req.body;
  const results = [];

  try {
    const querySnap = await db
      .collection('triggered_comments')
      .where('replied', '==', false)
      .get();

    const sentUsers = new Set();

    for (const doc of querySnap.docs) {
      const data = doc.data();
      const { user_id, user_name = '顾客', comment_id } = data;

      if (!user_id || sentUsers.has(user_id)) continue;
      sentUsers.add(user_id);

      const orderSnap = await db
        .collection('triggered_comments')
        .where('user_id', '==', user_id)
        .get();

      let total = 0;
      let productLines = [];

      for (const d of orderSnap.docs) {
        const { selling_id, product_name, quantity } = d.data();
        const productDoc = await db.collection('live_products').doc(selling_id).get();
        if (!productDoc.exists) continue;

        const product = productDoc.data();
        const rawPrice = typeof product.price === 'string' ? product.price.replace(/,/g, '') : product.price;
        const price = parseFloat(rawPrice || 0);
        const qty = parseInt(quantity) || 1;
        const subtotal = +(price * qty).toFixed(2);
        total += subtotal;
        productLines.push(`• ${selling_id} ${product_name} x${qty} = RM${subtotal.toFixed(2)}`);
      }

      const sgd = (total / 3.25).toFixed(2);
      const paymentMsg = [
        `感谢下单 ${user_name} 🙏`,
        ...productLines,
        '',
        `总金额：RM${total.toFixed(2)}`,
        `SGD${sgd} PayLah! / PayNow me @87158951 (Siang)`,
        '',
        '付款方式：',
        'Lover Legend Adenium',
        'Maybank：512389673060',
        'Public Bank：3214928526',
        '',
        'TNG 付款连接：',
        'https://liveorders-public-template.vercel.app/TNG.jpg'
      ].join('\n');

      if (channel === 'comment') {
        // 留言方式
        const url = `https://graph.facebook.com/${comment_id}/comments`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: paymentMsg, access_token: PAGE_TOKEN })
        });
        const fbRes = await r.json();
        if (r.ok) {
          await doc.ref.update({ replied: true });
          results.push({ user: user_name, method: 'comment', success: true });
        } else {
          results.push({ user: user_name, method: 'comment', success: false, error: fbRes });
        }
      } else {
        // Messenger 方式（模拟）
        results.push({ user: user_name, method: 'messenger', success: true });
        // 实际应用中应调用 Send API 或 ManyChat API 发送 Messenger 讯息
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
