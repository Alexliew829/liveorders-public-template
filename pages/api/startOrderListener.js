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
    // ✅ Step 1：清空 live_products 与 triggered_comments
    const collections = ['live_products', 'triggered_comments'];
    for (const col of collections) {
      const snapshot = await db.collection(col).get();
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    // ✅ Step 2：获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    // ✅ Step 3：获取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    let count = 0;

    for (const { message, from } of comments) {
      if (!message || !from || from.id === PAGE_ID) continue;

      // ✅ 编号格式匹配：B001、a22、A 88、b-7 等
      const match = message.match(/\b([ABab])[ \-_.～~]*0*(\d{1,3})\b/);
      if (!match) continue;
      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      // ✅ 价格匹配：支持 RM123.45 或 88.00
      const priceMatch = message.match(/([RMrm]?\s?[\d,]+\.\d{2})/);
      if (!priceMatch) continue;
      const price_raw = parseFloat(priceMatch[1].replace(/[^\d.]/g, ''));
      const price = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      // ✅ 去除编号与价格，提取商品名
      const afterId = message.replace(/\b[ABab][ \-_.～~]*0*\d{1,3}\b/, '').trim();
      const afterPrice = afterId.replace(/([RMrm]?\s?[\d,]+\.\d{2})/, '').trim();
      const product_name = afterPrice;

      await db.collection('live_products').doc(selling_id).set({
        selling_id,
        type,
        number,
        product_name,
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
      debug: isDebug,
    });

  } catch (err) {
    console.error('🔥 执行失败:', err);
    return res.status(500).json({ error: '执行失败', details: err.message });
  }
}
