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

  const { comment_id } = req.body;
  if (!comment_id) {
    return res.status(400).json({ error: '缺少 comment_id 参数' });
  }

  try {
    const ordersSnapshot = await db
      .collection('triggered_comments')
      .where('comment_id', '==', comment_id)
      .get();

    if (ordersSnapshot.empty) {
      return res.status(404).json({ error: '找不到对应留言' });
    }

    const orderData = ordersSnapshot.docs[0].data();
    const user = orderData.user_name || '匿名顾客';
    const userId = orderData.user_id;
    const postId = orderData.post_id;

    const allOrdersSnapshot = await db
      .collection('triggered_comments')
      .where('user_id', '==', userId)
      .where('post_id', '==', postId)
      .get();

    let total = 0;
    let messageLines = [];

    allOrdersSnapshot.forEach(doc => {
      const data = doc.data();
      const qty = data.quantity || 1;
      const unitPrice = parseFloat(data.price) || 0;
      const sub = unitPrice * qty;
      total += sub;

      messageLines.push(
        `▪️ ${data.selling_id} ${data.product_name} RM${unitPrice.toFixed(2)} x${qty} = RM${sub.toFixed(2)}`
      );
    });

    const fullMessage = [
      `感谢下单 ${user} 🙏`,
      '',
      ...messageLines,
      '',
      `总金额：RM${total.toFixed(2)}`,
      '',
      '付款方式：',
      'Maybank：512389673060',
      'Public Bank：3214928526',
      'TNG电子钱包：',
      'https://payment.tngdigital.com.my/sc/dRacq2iFOb'
    ].join('\n');

    const replyRes = await fetch(`https://graph.facebook.com/v18.0/${comment_id}/comments?access_token=${PAGE_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: fullMessage })
    });

    const replyData = await replyRes.json();
    if (!replyRes.ok) {
      return res.status(500).json({ error: '发送失败', details: replyData });
    }

    await db.collection('triggered_comments').doc(allOrdersSnapshot.docs[0].id).update({ replied: true });

    return res.status(200).json({ success: true, message: '付款连接已发送' });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', details: err.message });
  }
}
