import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  const { comment_id } = req.body;
  if (!comment_id) {
    return res.status(400).json({ error: '缺少 comment_id 参数' });
  }

  try {
    // ✅ 用 comment_id 查找文档（不依赖文档 ID）
    const snapshot = await db.collection('triggered_comments')
      .where('comment_id', '==', comment_id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: '找不到对应留言' });
    }

    const docRef = snapshot.docs[0].ref;
    const data = snapshot.docs[0].data();

    if (data.replied === true) {
      return res.status(400).json({ error: '该留言已发送过付款连接' });
    }

    // ✅ 生成付款文字（可自定义格式）
    const total = (parseFloat(data.price) || 0) * (parseInt(data.quantity) || 1);
    const paymentText = `感谢下单 ${data.user_name || ''} 🙏\n` +
      `${data.selling_id || ''} ${data.product_name || ''} RM${parseFloat(data.price).toFixed(2)} x ${data.quantity} = RM${total.toFixed(2)}\n\n` +
      `付款方式：\nMaybank：512389673060\nPublic Bank：3214928526\nTNG电子钱包：\nhttps://payment.tngdigital.com.my/sc/dRacq2iFOb`;

    // ✅ 用 Graph API 留言回复
    const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;
    const response = await fetch(`https://graph.facebook.com/v19.0/${comment_id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: paymentText,
        access_token: PAGE_TOKEN
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: result.error?.message || '发送留言失败', raw: result });
    }

    // ✅ 回写状态
    await docRef.update({ replied: true });

    return res.status(200).json({ success: true, message: '付款信息已发送' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
