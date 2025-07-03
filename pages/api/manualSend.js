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
  const comment_id =
    req.method === 'POST' ? req.body.comment_id : req.query.comment_id;

  const channel =
    req.method === 'POST' ? req.body.channel : req.query.channel || 'comment'; // comment | messenger

  if (!comment_id) {
    return res.status(400).json({ error: '缺少 comment_id 参数' });
  }

  try {
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

    const orderSnap = await db
      .collection('triggered_comments')
      .where('user_id', '==', user_id)
      .get();

    let total = 0;
    let productLines = [];

    for (const doc of orderSnap.docs) {
      const { selling_id, product_name, quantity } = doc.data();

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
      'Public Bank：3214928526',
      '',
      'TNG 付款连接：',
      'https://liveorders-public-template.vercel.app/TNG.jpg'
    ].join('\n');

    // ✅ 发送付款讯息（公开留言或 Messenger）
    let fbRes;
    if (channel === 'messenger') {
      // 发送到 Messenger
      const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`;
      const body = {
        recipient: { id: user_id },
        message: { text: paymentMessage },
        messaging_type: 'UPDATE'
      };

      const messengerRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      fbRes = await messengerRes.json();
      if (!messengerRes.ok) {
        return res.status(500).json({ error: 'Messenger 发送失败', fbRes });
      }

      // Messenger 发送成功后，再公开留言提示
      const commentUrl = `https://graph.facebook.com/${comment_id}/comments`;
      const commentTip = '✅ 已发到 Messenger，请查阅 Inbox';
      await fetch(commentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commentTip,
          access_token: PAGE_TOKEN
        })
      });
    } else {
      // 默认：公开留言发送付款讯息
      const url = `https://graph.facebook.com/${comment_id}/comments`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: paymentMessage,
          access_token: PAGE_TOKEN
        })
      });

      fbRes = await r.json();
      if (!r.ok) {
        return res.status(500).json({ error: '留言发送失败', fbRes });
      }
    }

    await commentSnap.ref.update({ replied: true });

    return res.status(200).json({ success: true, total: total.toFixed(2), fbRes });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
