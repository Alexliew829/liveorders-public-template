import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

// 可添加多个管理员 ID（主页 ID + 管理员个人账号）
const ADMIN_IDS = [PAGE_ID]; // 后续可手动加入其他管理员 ID

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  const { post_id } = req.query;
  if (!post_id) {
    return res.status(400).json({ error: '缺少 post_id 参数' });
  }

  try {
    const commentRes = await fetch(
      `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id,created_time&limit=100`
    );
    const commentData = await commentRes.json();

    if (!commentData?.data?.length) {
      return res.status(404).json({ error: '找不到任何留言', raw: commentData });
    }

    let successCount = 0;

    for (const comment of commentData.data) {
      const { message, from, id: comment_id, created_time } = comment;
      if (!message || !from || !from.id) continue;

      // 过滤管理员留言
      if (ADMIN_IDS.includes(from.id)) continue;

      // 识别留言格式：B1、b01、B001、b 01 等
      const match = message.match(/\b[bB][\s0]*([0-9]{1,3})\b/);
      if (!match) continue;

      const rawId = match[1];
      const selling_id = `B${rawId.padStart(3, '0')}`;

      // 检查是否已有访客下单该商品
      const existing = await db.collection('triggered_comments')
        .where('selling_id', '==', selling_id)
        .get();
      if (!existing.empty) continue;

      // 获取商品资料
      const productSnap = await db.collection('live_products').doc(selling_id).get();
      if (!productSnap.exists) continue;
      const product = productSnap.data();

      const user_id = from.id;
      const user_name = from.name || '';
      const shortId = comment_id.slice(-6);
      const payment_url = `https://pay.example.com/${selling_id}-${shortId}`;

      await db.collection('triggered_comments').doc(comment_id).set({
        selling_id,
        post_id,
        comment_id,
        user_id,
        user_name,
        replied: false,
        status: 'pending',
        product_name: product.product_name,
        price_fmt: product.price_fmt,
        payment_url,
        created_at: new Date(),
      });

      successCount++;
    }

    return res.status(200).json({ success: true, inserted: successCount });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
