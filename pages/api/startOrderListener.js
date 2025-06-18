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
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    // 获取留言
    const allComments = [];
    let nextPage = `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=id,message,from,created_time&limit=100`;

    while (nextPage) {
      const res = await fetch(nextPage);
      const data = await res.json();
      allComments.push(...(data.data || []));
      nextPage = data.paging?.next || null;
    }

    let writeCount = 0;

    for (const comment of allComments) {
      const message = comment.message || '';

      // 支持 B001 / b 001 / a88 / A 08 / b012 RM1.2k 等变体
      const match = message.match(/\b([ab])\s*0*(\d{1,3})\b[\s\-~_]*([^\n\r]*?)\s*rm\s*([\d,\.kK]+)/i);
      if (!match) continue;

      const category = match[1].toUpperCase(); // A or B
      const idNumber = match[2].padStart(3, '0'); // 补足为三位
      const product_name = match[3].trim(); // 商品名
      const rawPrice = match[4].toLowerCase();

      const numericPrice = rawPrice.includes('k')
        ? parseFloat(rawPrice) * 1000
        : parseFloat(rawPrice.replace(/,/g, ''));

      const price_fmt = numericPrice.toLocaleString('en-MY', {
        style: 'currency',
        currency: 'MYR',
        minimumFractionDigits: 2,
      });

      const selling_id = `${category}${idNumber}`;

      const docRef = db.collection('live_products').doc(selling_id);
      const existing = await docRef.get();
      if (existing.exists) continue;

      await docRef.set({
        selling_id,
        product_name,
        price_raw: numericPrice,
        price_fmt,
        post_id,
        comment_id: comment.id,
        category,
        created_at: new Date().toISOString(),
      });

      writeCount++;
    }

    res.status(200).json({
      status: 'success',
      message: `成功写入 ${writeCount} 项商品`,
      post_id,
    });
  } catch (err) {
    console.error('写入商品失败：', err);
    res.status(500).json({ error: '服务器内部错误', details: err.message });
  }
}
