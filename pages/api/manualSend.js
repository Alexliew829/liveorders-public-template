import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

function formatCurrency(amount) {
  return 'RM' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export default async function handler(req, res) {
  const { comment_id } = req.query;
  if (!comment_id) return res.status(400).json({ error: '缺少 comment_id 参数' });

  try {
    const commentRef = db.collection('triggered_comments').doc(comment_id);
    const commentSnap = await commentRef.get();
    if (!commentSnap.exists) return res.status(404).json({ error: '找不到订单留言' });

    const commentData = commentSnap.data();
    const user_name = commentData.user_name || '顾客';
    const user_id = commentData.user_id;

    const allOrdersSnap = await db
      .collection('triggered_comments')
      .where('user_name', '==', user_name)
      .get();

    let total = 0;
    const lines = [];

    for (const doc of allOrdersSnap.docs) {
      const { selling_id, product_name, price, quantity } = doc.data();
      const subtotal = price * quantity;
      total += subtotal;
      lines.push(`\u2022 ${selling_id} ${product_name} ${formatCurrency(price)} x${quantity} = ${formatCurrency(subtotal)}`);
    }

    const message = `感谢下单 ${user_name} 🙏\n` +
      lines.join('\n') +
      `\n总金额：${formatCurrency(total)}\n\n付款方式：\nMaybank：512389673060\nPublic Bank：3214928526\nTNG电子钱包：\nhttps://payment.tngdigital.com.my/sc/dRacq2iFOb`;

    const replyRes = await fetch(`https://graph.facebook.com/v18.0/${comment_id}/comments?access_token=${PAGE_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const fbData = await replyRes.json();
    if (fbData.error) throw new Error(fbData.error.message);

    await commentRef.update({ replied: true });

    res.status(200).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
