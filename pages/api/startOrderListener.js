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
    // ✅ 1. 清空旧数据
    const collections = ['live_products', 'triggered_comments'];
    for (const col of collections) {
      const snapshot = await db.collection(col).get();
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    // ✅ 2. 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    // ✅ 3. 抓取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    let count = 0;

    for (const comment of comments) {
      const { message, id: comment_id, from } = comment;
      if (!message || !from || from.id !== PAGE_ID) continue; // 跳过访客留言

      // ✅ 提取编号（A/B + 数字）
      const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
      if (!match) continue;

      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      // ✅ 提取价格（格式如 RM1234.56、rm 1,234.56、5555.55）
      const priceMatch = message.match(/(?:RM|rm)?[^\d]*([\d,]+\.\d{2})\s*$/i);
      if (!priceMatch) continue;

      const price_raw = parseFloat(priceMatch[1].replace(/,/g, ''));
      const price = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      // ✅ 提取商品名称（去编号、去价格，最多9个字）
      let name = message
        .replace(/^[AB][ \-_.～]*0*\d{1,3}/i, '') // 去除开头编号
        .replace(/\s*(?:RM|rm)?[^\d]*[\d,]+\.\d{2}\s*$/i, '') // 去除尾部价格
        .trim();
      name = name.slice(0, 9); // 限制最多9个字

      // ✅ 写入 Firestore
      await db.collection('live_products').doc(selling_id).set({
        selling_id,
        type,
        number,
        product_name: name,
        raw_message: message,
        price_raw,
        price,
        created_at: new Date().toISOString(),
        post_id,
      });

      count++;
    }

    return res.status(200).json({
      message: '商品写入完成',
      success: count,
      skipped: comments.length - count,
      post_id,
    });

  } catch (err) {
    console.error('错误：', err);
    return res.status(500).json({ error: '执行失败', details: err.message });
  }
}
