// pages/api/startOrderListener.js
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
  const isDebug = req.query.debug !== undefined;

  if (req.method !== 'POST' && !isDebug) {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '未获取到帖子 ID', raw: postData });
    }

    if (isDebug) {
      return res.status(200).json({ debug: true, post_id, message: '获取成功，可执行监听操作' });
    }

    // 获取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from,id,created_time&limit=100`);
    const commentData = await commentRes.json();

    if (!commentData?.data?.length) {
      return res.status(404).json({ error: '找不到任何留言', raw: commentData });
    }

    let successCount = 0;

    for (const comment of commentData.data) {
      const { message, from, id: comment_id, created_time } = comment;
      if (!message || !from || from.id !== PAGE_ID) continue; // 只处理主页留言

      const now = new Date();
      const createdAt = new Date(created_time);
      if (now - createdAt > 30 * 60 * 1000) continue; // 30分钟限制

      // 宽容格式：B001 商品名 RM1234.56 或 A001 商品名 RM1234.56
      const regex = /([AaBb])\s*0*(\d{1,3})\s+(.+?)\s+(?:RM|rm)?\s*([\d,.]+)/i;
      const match = message.match(regex);
      if (!match) continue;

      const abType = match[1].toUpperCase();
      const rawId = match[2];
      const product_name = match[3]?.trim(); // 保留原样
      const rawPrice = match[4]?.replace(/,/g, '');

      const selling_id = `${abType}${rawId.padStart(3, '0')}`;
      const price_raw = parseFloat(rawPrice).toFixed(2);
      const price_fmt = parseFloat(rawPrice).toLocaleString('en-MY', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const allow_multiple = abType === 'A'; // A类可多人下单，B类限一人

      const docRef = db.collection('live_products').doc(selling_id);
      await docRef.set({
        selling_id,
        post_id,
        product_name,
        price_raw,
        price_fmt,
        comment_id,
        allow_multiple,
        created_at: new Date(),
      });

      successCount++;
    }

    return res.status(200).json({ success: true, inserted: successCount });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
