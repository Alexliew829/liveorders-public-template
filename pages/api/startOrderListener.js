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
  const isForce = req.query.force !== undefined;

  if (req.method !== 'POST' && !isDebug) {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // ✅ 尝试先从 /videos 抓取直播影片 ID
    let post_id = null;
    let source = 'videos';
    let resVideo = await fetch(`https://graph.facebook.com/${PAGE_ID}/videos?access_token=${PAGE_TOKEN}&limit=3`);
    let dataVideo = await resVideo.json();

    if (dataVideo?.data?.length) {
      post_id = dataVideo.data[0].id;
    }

    // ❌ 如果 /videos 抓不到，再尝试从 /feed 中抓
    if (!post_id) {
      source = 'feed';
      let resFeed = await fetch(`https://graph.facebook.com/${PAGE_ID}/feed?access_token=${PAGE_TOKEN}&limit=5`);
      let dataFeed = await resFeed.json();
      const livePost = dataFeed?.data?.find(p => p.status_type === 'live_video' || p.message?.includes('直播'));
      if (livePost) post_id = livePost.id;
    }

    if (!post_id) {
      return res.status(404).json({ error: '无法取得直播贴文 ID，可能尚未开播' });
    }

    // ✅ 获取上次记录的贴文 ID
    const configRef = db.collection('config').doc('last_post_id');
    const configSnap = await configRef.get();
    const last_post_id = configSnap.exists ? configSnap.data().post_id : null;
    const isNewLive = post_id !== last_post_id;

    // ✅ 每次都清空 live_products
    const liveSnap = await db.collection('live_products').get();
    const batch1 = db.batch();
    liveSnap.forEach(doc => batch1.delete(doc.ref));
    await batch1.commit();

    // ✅ 仅在新直播 或 force 模式下，清空 triggered_comments
    if (isNewLive || isForce) {
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

    // ✅ 获取留言（主页）
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

      const priceMatch = message.match(/(?:RM|rm)?[^\d]*([\d,]+\.\d{2})(?:[^0-9]*[-_~～. ]?(\d+))?\s*$/i);
      if (!priceMatch) continue;

      const price_raw = parseFloat(priceMatch[1].replace(/,/g, ''));
      const price = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      const stock = type === 'A'
        ? (priceMatch[2] ? parseInt(priceMatch[2]) : 50)
        : undefined;

      let name = message;
      name = name.replace(/^[AB][ \-_.～]*0*\d{1,3}/i, '');
      name = name.replace(/\s*(RM|rm)?\s*[\d,]+\.\d{2}(?:[^0-9]*[-_~～. ]?\d+)?\s*$/i, '');
      name = name.trim().slice(0, 30);

      await db.collection('live_products').doc(selling_id).set({
        selling_id,
        type,
        number,
        product_name: name,
        raw_message: message,
        price_raw,
        price,
        ...(type === 'A' && { stock }),
        created_at: new Date().toISOString(),
        post_id,
      });

      count++;
    }

    return res.status(200).json({
      message: '商品写入完成',
      post_id,
      source,
      success: count,
      skipped: comments.length - count,
      isNewLive,
      isForce,
    });

  } catch (err) {
    console.error('执行错误：', err);
    return res.status(500).json({ error: '执行失败', details: err.message });
  }
}
