import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    const snapshot = await db
      .collection('triggered_comments')
      .where('status', '==', 'pending')
      .orderBy('created_at', 'asc')
      .limit(30)
      .get();

    let success = 0, failed = 0, skipped = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const comment_id = data.comment_id;

      if (!comment_id || data.replied || data.status === 'sent') {
        skipped++;
        continue;
      }

      const message = [
        data.user_name ? `感谢下单 @${data.user_name} 🙏` : '感谢您的下单 🙏',
        `${data.selling_id} ${data.product_name} RM${data.price_fmt}`,
        `付款连接：${data.payment_url}`,
        '⚠️ 请在 60 分钟内完成付款，逾期将自动取消 ⚠️'
      ].join('\n');

      const replyRes = await fetch(`https://graph.facebook.com/v18.0/${comment_id}/comments?access_token=${PAGE_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });

      const replyData = await replyRes.json();

      if (!replyRes.ok || !replyData.id) {
        failed++;
        continue;
      }

      await doc.ref.update({
        replied: true,
        status: 'sent',
        sent_at: new Date()
      });

      success++;
    }

    return res.status(200).json({ message: '发送完成', success, failed, skipped });
  } catch (err) {
    console.error('[付款连接发送失败]', err);
    return res.status(500).json({ error: '发送失败', detail: err.message });
  }
}
