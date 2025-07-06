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
  const forceUseFeed = req.query.forceUseFeed !== undefined;

  if (req.method !== 'POST' && !isDebug) {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // ✅ 获取最新贴文 ID（直播时优先抓 videos，否则抓 feed）
    let post_id = null;
    let used = null;

    if (!forceUseFeed) {
      const videoRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/live_videos?access_token=${PAGE_TOKEN}&fields=id,status&limit=5`);
      const videoData = await videoRes.json();
      const active = videoData?.data?.find(v => v.status === 'LIVE');
      if (active?.id) {
        post_id = active.id;
        used = 'videos';
      }
    }

    if (!post_id) {
      const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
      const postData = await postRes.json();
      post_id = postData?.data?.[0]?.id;
      used = 'feed';
    }

    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID' });
    }

    // ✅ 清空 live_products（每次）
    const liveSnap = await db.collection('live_products').get();
    const batch1 = db.batch();
    liveSnap.forEach(doc => batch1.delete(doc.ref));
    await batch1.commit();

    // ✅ 清空 triggered_comments（仅 force）
    if (isForce) {
      const orderSnap = await db.collection('triggered_comments').get();
      const batch2 = db.batch();
      orderSnap.forEach(doc => batch2.delete(doc.ref));
      await batch2.commit();
    }

    // ✅ 写入 config.post_id
    await db.collection('config').doc('last_post_id').set({ post_id });

    // ✅ 抓留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    let count = 0;
    for (const comment of comments) {
      const { message, id: comment_id, from } = comment;
      if (!message || !from || from.id !== PAGE_ID) continue;

      console.log('📌 留言内容:', message);

      const match = message.match(/\b([AB])[ \-_.～]*0*(\d{1,3})\b/i);
      if (!match) {
        console.log('⛔️ 无匹配编号，跳过');
        continue;
      }

      const type = match[1].toUpperCase();
      const number = match[2].padStart(3, '0');
      const selling_id = `${type}${number}`;

      const priceMatch = message.match(/(?:RM|rm)?[^\d]*([\d,]+\.\d{2})(?:[^0-9]*[-_~～. ]?(\d+))?\s*$/i);
      if (!priceMatch) {
        console.log('❌ 无法识别价格格式，跳过');
        continue;
      }

      const price_raw = parseFloat(priceMatch[1].replace(/,/g, ''));
      const price = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      const stock = type === 'A' ? (priceMatch[2] ? parseInt(priceMatch[2]) : 50) : undefined;

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
      message: '✅ 商品强制写入完成',
      post_id,
      success: count,
      skipped: comments.length - count,
      isForce,
      used,
    });

  } catch (err) {
    console.error('执行错误：', err);
    return res.status(500).json({ error: '执行失败', details: err.message });
  }
}
