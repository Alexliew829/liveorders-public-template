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
    // ✅ 获取 Feed（图文或视频贴）中最新贴文
    const feedRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?fields=id,created_time&access_token=${PAGE_TOKEN}&limit=5`);
    const feedData = await feedRes.json();
    const latestFeedPost = feedData?.data?.[0];
    let post_id = latestFeedPost?.id;

    // ✅ 获取视频列表，判断 Feed 中的贴文是否是视频贴
    const videoRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/videos?fields=id,created_time&access_token=${PAGE_TOKEN}&limit=5`);
    const videoData = await videoRes.json();
    const videoIds = (videoData?.data || []).map(v => v.id);

    // ✅ 如果最新 Feed 贴文出现在视频列表中 → 使用视频 ID（可抓留言）
    if (videoIds.includes(post_id)) {
      post_id = videoIds[0]; // 使用最新视频 ID
    }

    if (!post_id) {
      return res.status(404).json({ error: '无法取得最新贴文 ID', raw: { feedData, videoData } });
    }

    // ✅ 分页抓留言
    let comments = [];
    let nextUrl = `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`;
    while (nextUrl) {
      const commentRes = await fetch(nextUrl);
      const commentData = await commentRes.json();
      if (commentData?.data?.length) {
        comments.push(...commentData.data);
      }
      nextUrl = commentData?.paging?.next || null;
    }

    let count = 0;
    const productList = [];

    for (const comment of comments) {
      const { message, id: comment_id, from } = comment;
      if (!message || !from || from.id !== PAGE_ID) continue;

      const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
      if (!match) continue;

      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      const priceMatch = message.match(/(?:RM|rm)?[^\d]*([\d,]+(?:\.\d{2})?)(?:[^0-9]*[-_~～. ]?(\d+))?\s*$/i);
      if (!priceMatch) continue;

      const price_raw = parseFloat(priceMatch[1].replace(/,/g, ''));
      const price = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });
      const stock = type === 'A'
        ? (priceMatch[2] ? parseInt(priceMatch[2]) : 50)
        : undefined;

      let name = message;
      name = name.replace(/^[AB][ \-_.～]*0*\d{1,3}/i, '');
      name = name.replace(/\s*(RM|rm)?\s*[\d,]+(?:\.\d{2})?(?:[^0-9]*[-_~～. ]?\d+)?\s*$/i, '');
      name = name.trim().slice(0, 30);
      if (!name) name = '未命名商品';

      productList.push({
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

    if (count === 0) {
      return res.status(200).json({
        message: '⚠️ 没有侦测到任何商品资料，系统未写入任何数据',
        post_id,
        success: 0,
        skipped: comments.length,
        debug_samples: comments.slice(0, 10).map(c => ({
          id: c.id,
          from: c.from?.name || '(匿名)',
          message: c.message
        }))
      });
    }

    // ✅ 取得旧 ID，判断是否新直播
    const configRef = db.collection('config').doc('last_post_id');
    const configSnap = await configRef.get();
    const last_post_id = configSnap.exists ? configSnap.data().post_id : null;
    const isNewLive = last_post_id !== post_id;

    // ✅ 清空 live_products
    const liveSnap = await db.collection('live_products').get();
    const batch1 = db.batch();
    liveSnap.forEach(doc => batch1.delete(doc.ref));
    await batch1.commit();

    // ✅ 清空 triggered_comments（只在新直播时清空）
    if (isNewLive) {
      const orderSnap = await db.collection('triggered_comments').get();
      const batch2 = db.batch();
      orderSnap.forEach(doc => batch2.delete(doc.ref));
      await batch2.commit();
    }

    // ✅ 写入商品资料
    for (const product of productList) {
      await db.collection('live_products').doc(product.selling_id).set(product);
    }

    // ✅ 成功写入商品后，才写入最新 Post ID
    await configRef.set({ post_id });

    return res.status(200).json({
      message: '✅ 商品写入完成',
      post_id,
      success: count,
      skipped: comments.length - count,
      isNewLive,
    });

  } catch (err) {
    console.error('执行错误：', err);
    return res.status(500).json({ error: '执行失败', details: err.message });
  }
}
