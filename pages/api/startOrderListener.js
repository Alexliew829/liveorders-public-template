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
    // ✅ 获取最新 Facebook 贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    // ✅ 获取上次记录的 Post ID
    const configRef = db.collection('config').doc('last_post_id');
    const configSnap = await configRef.get();
    const last_post_id = configSnap.exists ? configSnap.data().post_id : null;
    const isNewLive = last_post_id !== post_id;

    // ✅ 清空 live_products（每次都清空）
    const liveSnap = await db.collection('live_products').get();
    const batch1 = db.batch();
    liveSnap.forEach(doc => batch1.delete(doc.ref));
    await batch1.commit();

    // ✅ 如果是新直播，清空 triggered_comments
    if (isNewLive) {
      const orderSnap = await db.collection('triggered_comments').get();
      const batch2 = db.batch();
      orderSnap.forEach(doc => batch2.delete(doc.ref));
      await batch2.commit();
    }

    // ✅ 更新最新 Post ID
    try {
      await configRef.set({ post_id });
    } catch (err) {
      return res.status(500).json({ error: '写入 config.post_id 失败', details: err.message });
    }

    // ✅ 获取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    let count = 0;
    for (const comment of comments) {
      const { message, id: comment_id, from } = comment;
      if (!message || !from || from.id !== PAGE_ID) continue;

      const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
      if (!match) continue;

      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      // ✅ 提取价格与库存（如 RM32.32-200）
      const priceMatch = message.match(/(?:RM|rm)?[^\d]*([\d,]+\.\d{2})(?:[^0-9]*[-_~～. ]?(\d+))?\s*$/i);
      if (!priceMatch) continue;

      const price_raw = parseFloat(priceMatch[1].replace(/,/g, ''));
      const price = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      // ✅ 没写库存就默认为 1（只针对 A 类）
      const stock = type === 'A'
        ? (priceMatch[2] ? parseInt(priceMatch[2]) : 1)
        : undefined;

      // ✅ 提取商品名
      let name = message;
      name = name.replace(/^[AB][ \-_.～]*0*\d{1,3}/i, '');
      name = name.replace(/\s*(RM|rm)?\s*[\d,]+\.\d{2}(?:[^0-9]*[-_~～. ]?\d+)?\s*$/i, '');
      name = name.trim().slice(0, 30); // 最多30字

      await db.collection('live_products').doc(selling_id).set({
        selling_id,
        type,
        number,
        product_name: name,
        raw_message: message,
        price_raw,
        price,
        ...(type === 'A' && { stock }), // ✅ 仅 A 类写入库存，未写则为 1
        created_at: new Date().toISOString(),
        post_id,
      });

      count++;
    }

    return res.status(200).json({
      message: '商品写入完成',
      post_id,
      success: count,
      skipped: comments.length - count,
      isNewLive,
    });

  } catch (err) {
    console.error('错误：', err);
    return res.status(500).json({ error: '执行失败', details: err.message });
  }
}
