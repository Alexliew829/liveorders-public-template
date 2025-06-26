import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  const debug = req.query.debug === '1';

  try {
    // 获取最新贴文 ID
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) throw new Error('无法获取贴文 ID');

    // 清空 live_products 和 triggered_comments
    const liveSnap = await db.collection('live_products').get();
    const commentSnap = await db.collection('triggered_comments').get();
    const batch = db.batch();
    liveSnap.docs.forEach(doc => batch.delete(doc.ref));
    commentSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // 获取留言
    const commentRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=1000`);
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    let count = 0;
    for (const c of comments) {
      const message = c.message?.trim();
      if (!message) continue;

      // 留言格式匹配
      const match = message.match(/^([ABab][\s\-]*0*(\d{1,3}))[^\u4e00-\u9fa5A-Za-z0-9]*[\s\-~_，。、]*([^\sRMrm\d]*).*?(RM|rm)?\s*([\d,]+\.\d{2})/);
      if (!match) continue;

      const raw_number = match[1];
      const number = match[2];
      const name = match[3];
      const priceStr = match[5];

      const type = raw_number[0].toUpperCase(); // A 或 B
      const selling_id = `${type}${number.padStart(3, '0')}`;
      const price_raw = parseFloat(priceStr.replace(/,/g, ''));
      const price = price_raw.toLocaleString('en-MY', { minimumFractionDigits: 2 });

      const product_name = `${selling_id} ${name.trim()}`;
      const docData = {
        selling_id,
        type,
        number: number.padStart(3, '0'),
        product_name,
        raw_message: message,
        price_raw,
        price,
        created_at: new Date().toISOString(),
        post_id,
      };

      await db.collection('live_products').doc(selling_id).set(docData);
      count++;
    }

    return res.status(200).json({
      message: `${debug ? '测试写入' : '成功写入'} ${count} 项商品资料（含清空 triggered_comments）`
    });
  } catch (err) {
    console.error('错误：', err);
    return res.status(500).json({ error: err.message });
  }
}
