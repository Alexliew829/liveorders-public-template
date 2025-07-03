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
  try {
    const orderSnap = await db
      .collection('triggered_comments')
      .where('replied', '!=', true)
      .get();

    if (orderSnap.empty) {
      return res.status(200).json({ message: '没有待发订单' });
    }

    let successCount = 0;
    let failCount = 0;
    let errors = [];

    for (const doc of orderSnap.docs) {
      const { comment_id, user_id, user_name } = doc.data();
      const orderItemsSnap = await db
        .collection('triggered_comments')
        .where('user_id', '==', user_id)
        .get();

      let total = 0;
      let productLines = [];

      for (const orderDoc of orderItemsSnap.docs) {
        const { selling_id, product_name, quantity } = orderDoc.data();
        const productDoc = await db.collection('live_products').doc(selling_id).get();
        const productData = productDoc.exists ? productDoc.data() : null;
        if (!productData) continue;

        const rawPrice = typeof productData.price === 'string'
          ? productData.price.replace(/,/g, '')
          : productData.price;
        const price = parseFloat(rawPrice || 0);
        const qty = parseInt(quantity) || 1;
        const subtotal = +(price * qty).toFixed(2);
        total = +(total + subtotal).toFixed(2);

        productLines.push(`▪️ ${selling_id} ${product_name} x${qty} = RM${subtotal.toFixed(2)}`);
      }

      const totalStr = `总金额：RM${total.toFixed(2)}`;
      const sgd = (total / 3.25).toFixed(2);
      const sgdStr = `SGD${sgd} PayLah! / PayNow me @87158951 (Siang)`;

      const paymentMessage = [
        `感谢下单 ${user_name || '顾客'} 🙏`,
        ...productLines,
        '',
        totalStr,
        sgdStr,
        '',
        '付款方式：',
        'Lover Legend Adenium',
        'Maybank：512389673060',
        'Public Bank：3214928526'
      ].join('\n');

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
      if (r.ok) {
        await doc.ref.update({ replied: true });
        successCount++;
      } else {
        failCount++;
        errors.push({ comment_id, fbRes });
      }
    }

    return res.status(200).json({
      message: `成功发送 ${successCount} 位顾客，失败 ${failCount} 位`,
      errors
    });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
