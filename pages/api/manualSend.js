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
  const { comment_id, method = 'comment' } =
    req.method === 'POST' ? req.body : req.query;

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

      const productDoc = await db
        .collection('live_products')
        .doc(selling_id)
        .get();
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
      `感谢下单 🙏`,
      ...productLines,
      '',
      totalStr,
      sgdStr,
      '',
      '付款方式：',
      'Lover Legend Adenium',
      'Maybank：512389673060',
      'Public Bank：3214928526',
      'TNG 付款连接：https://liveorders-public-template.vercel.app/TNG.jpg'
    ].join('\n');

    // ✅ Step 1: 发送 Messenger 私讯（订单内容，使用 RESPONSE 类型 + v17.0 更稳定）
    const messengerRes = await fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: user_id },
        message: { text: paymentMessage },
        messaging_type: 'RESPONSE'
      })
    });

    const messengerJson = await messengerRes.json();

    // ✅ Step 2: 留言提醒顾客查看 Messenger（不含名字）
    const notifyMessage = `感谢你的支持，订单详情已经发送到 Inbox 👉 https://m.me/lover.legend.gardening，请查阅 📥`;

    const commentRes = await fetch(`https://graph.facebook.com/${comment_id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: notifyMessage,
        access_token: PAGE_TOKEN
      })
    });

    const fbRes = await commentRes.json();

    // ✅ 判断两个发送结果
    if (!messengerRes.ok && !commentRes.ok) {
      return res.status(500).json({ error: '发送失败：Messenger 与 留言均失败', messengerJson, fbRes });
    }
    if (!messengerRes.ok) {
      return res.status(500).json({ error: '发送失败：发送 Messenger 私讯失败', messengerJson });
    }
    if (!commentRes.ok) {
      return res.status(500).json({ error: '发送失败：留言通知失败', fbRes });
    }

    await commentSnap.ref.update({ replied: true });

    return res.status(200).json({ success: true, total: total.toFixed(2) });
  } catch (err) {
    return res.status(500).json({ error: '系统错误', message: err.message });
  }
}
