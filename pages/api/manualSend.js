// pages/api/manualSend.js
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;
const PAGE_ID = process.env.PAGE_ID;

export default async function handler(req, res) {
  const { comment_id } = req.query;
  if (!comment_id) return res.status(400).json({ error: '缺少 comment_id 参数' });

  try {
    // 获取订单数据
    const orderSnapshot = await db.collection('triggered_comments').doc(comment_id).get();
    if (!orderSnapshot.exists) return res.status(404).json({ error: '订单不存在' });

    const orderData = orderSnapshot.data();
    if (orderData.replied) {
      return res.status(200).json({ message: '该订单已发送过付款信息，无需重复发送。' });
    }

    const customer = orderData.user_name || '顾客';

    // 获取该顾客的所有订单（同一个 user_name 且 replied 为 false）
    const allOrdersSnapshot = await db.collection('triggered_comments')
      .where('user_name', '==', orderData.user_name)
      .where('replied', '==', false)
      .get();

    if (allOrdersSnapshot.empty) {
      return res.status(404).json({ error: '找不到未发送连接的订单。' });
    }

    let items = [];
    let total = 0;

    for (const doc of allOrdersSnapshot.docs) {
      const item = doc.data();
      const quantity = item.quantity || 1;
      const price = item.price || 0;
      const lineTotal = quantity * price;
      total += lineTotal;
      items.push(`\u2022 ${item.selling_id} ${item.product_name} RM${price.toFixed(2)} x${quantity} = RM${lineTotal.toFixed(2)}`);
    }

    const paymentText = `感谢下单 ${customer} 🙏\n` +
      items.join('\n') +
      `\n总金额：RM${total.toFixed(2)}\n` +
      `付款方式：\nMaybank：512389673060\nPublic Bank：3214928526\n` +
      `TNG电子钱包：\nhttps://payment.tngdigital.com.my/sc/dRacq2iFOb`;

    // 发送留言回复
    await fetch(`https://graph.facebook.com/v18.0/${comment_id}/comments?access_token=${PAGE_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: paymentText })
    });

    // 更新所有订单为已回复
    const batch = db.batch();
    allOrdersSnapshot.docs.forEach(doc => {
      batch.update(doc.ref, { replied: true });
    });
    await batch.commit();

    return res.status(200).json({ message: '已成功发送付款信息并更新状态。' });

  } catch (err) {
    console.error('发送失败：', err);
    return res.status(500).json({ error: '服务器错误', details: err.message });
  }
}
