import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

// 固定付款连接
const PAYMENT_LINK = `https://payment.tngdigital.com.my/sc/dRacq2iFOb`;

export default async function handler(req, res) {
  try {
    const { comment_id } = req.query;
    if (!comment_id) {
      return res.status(400).json({ error: '缺少 comment_id 参数' });
    }

    // 查找顾客姓名
    const snapshot = await db.collection('triggered_comments')
      .where('comment_id', '==', comment_id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: '找不到对应留言' });
    }

    const refDoc = snapshot.docs[0];
    const { user_name, user_id } = refDoc.data();
    if (!user_name || !user_id) {
      return res.status(400).json({ error: '留言缺少 user_name 或 user_id' });
    }

    // 找出该顾客全部未发送的订单
    const ordersSnap = await db.collection('triggered_comments')
      .where('user_name', '==', user_name)
      .where('replied', '==', false)
      .get();

    if (ordersSnap.empty) {
      return res.status(404).json({ error: '无未发送订单' });
    }

    let total = 0;
    const lines = [];

    ordersSnap.forEach(doc => {
      const d = doc.data();
      const { selling_id, product_name, quantity, price } = d;

      const qty = Number(quantity || 1);
      const unitPrice = parseFloat(price || 0);
      const subtotal = unitPrice * qty;
      total += subtotal;

      const line = `▪️ ${selling_id} ${product_name} RM${unitPrice.toFixed(2)} x${qty} = RM${subtotal.toFixed(2)}`;
      lines.push(line);
    });

    const message = [
      `感谢下单 ${user_name} 🙏`,
      ``,
      ...lines,
      ``,
      `总金额：RM${total.toFixed(2)}`,
      ``,
      `付款方式：`,
      `Maybank：512389673060`,
      `Public Bank：3214928526`,
      `TNG电子钱包：`,
      PAYMENT_LINK
    ].join('\n');

    // 发出留言回复
    const replyRes = await fetch(`https://graph.facebook.com/v19.0/${comment_id}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        access_token: PAGE_TOKEN
      })
    });

    const replyData = await replyRes.json();

    if (!replyRes.ok) {
      return res.status(500).json({ error: '留言失败', detail: replyData });
    }

    // 更新所有订单为已发送
    const batch = db.batch();
    ordersSnap.forEach(doc => {
      batch.update(doc.ref, { replied: true });
    });
    await batch.commit();

    res.status(200).json({ success: true, user_name, total: total.toFixed(2), message });
  } catch (err) {
    res.status(500).json({ error: '系统错误', detail: err.message });
  }
}
