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
    // ✅ Step 1: 清空旧数据
    const collections = ['live_products', 'triggered_comments'];
    for (const col of collections) {
      const snap = await db.collection(col).get();
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }

    // ✅ Step 2: 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });

    // ✅ Step 3: 获取留言（stream 模式）
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=200`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    let count = 0;

    for (const comment of comments) {
      const { message, from } = comment;
      if (!message || !from || from.id !== PAGE_ID) continue; // 只处理主页留言

      // ✅ 编号提取
      const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
      if (!match) continue;
      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      // ✅ 价格提取（允许无 RM）
      const priceMatch = message.match(/([\d,]+\.\d{2})$/);
      if (!priceMatch) continue;
      const price_raw = parseFloat(priceMatch[1].replace(/,/g, ''));
      const price = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      // ✅ 商品名提取（去掉编号与价格）
      const product_name = message
        .replace(/\b[AB][ \-_.～]*0*\d{1,3}\b/i, '')
        .replace(/([\d,]+\.\d{2})$/, '')
        .replace(/\s+/g, ' ')
        .trim();

      await db.collection('live_products').doc(selling_id).set({
        selling_id,
        type,
        number,
        product_name: `${selling_id} ${product_name}`,
        raw_message: message,
        price_raw,
        price,
        created_at: new Date().toISOString(),
        post_id,
      });

      count++;
    }

    return res.status(200).json({
      message: `${isDebug ? '测试模式写入成功' : '商品写入完成'}`,
      success: count,
      skipped: comments.length - count,
      total: comments.length,
      post_id,
      debug: isDebug,
    });

  } catch (err) {
    console.error('🔥 执行失败:', err);
    return res.status(500).json({ error: '执行失败', details: err.message });
  }
}
