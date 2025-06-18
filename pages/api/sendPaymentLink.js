import { initializeApp, cert, getApps } from 'firebase-admin/app';
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

  try {
    // 自动获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    const snapshot = await db.collection('triggered_comments')
      .where('post_id', '==', post_id)
      .where('status', '==', 'pending')
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ message: '没有待发付款连接' });
    }

    const results = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const { comment_id, user_name, payment_url, product_name, price_fmt, selling_id } = data;

      const replyMessage = [
        user_name ? `感谢下单 @${user_name} 🙏` : `感谢您的下单 🙏`,
        `${selling_id} ${product_name} RM${price_fmt}`,
        `付款连接：${payment_url}`,
        `⚠️ 请在 60 分钟内完成付款，逾期将自动取消 ⚠️`
      ].join('\n');

      const replyRes = await fetch(`https://graph.facebook.com/v18.0/${comment_id}/comments?access_token=${PAGE_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyMessage })
      });

      const replyData = await replyRes.json();

      if (replyRes.ok) {
        await doc.ref.update({
          replied: true,
          status: 'sent',
          sent_at: new Date()
        });
        results.push({ comment_id, success: true, reply_id: replyData.id });
      } else {
        results.push({ comment_id, success: false, error: replyData });
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
