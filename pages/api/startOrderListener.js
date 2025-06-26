// File: pages/api/startOrderListener.js

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

function normalizeSellingId(text) {
  const match = text.match(/[AB]\s*0*([1-9]\d{0,2})/i);
  if (!match) return null;
  const prefix = text.match(/[AB]/i)[0].toUpperCase();
  const num = match[1].padStart(3, '0');
  return prefix + num;
}

function extractPrice(text) {
  const match = text.match(/RM?[\s:]?([\d,.]+)/i);
  if (!match) return null;
  const raw = parseFloat(match[1].replace(/,/g, ''));
  const formatted = raw.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { price: formatted, price_raw: raw };
}

export default async function handler(req, res) {
  try {
    const postRes = await fetch(`https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`);
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;
    if (!post_id) return res.status(404).json({ error: '无法获取贴文 ID', raw: postData });

    // 清空旧商品资料
    const productsRef = db.collection('live_products');
    const old = await productsRef.listDocuments();
    await Promise.all(old.map(doc => doc.delete()));

    // 抓取留言
    const commentsRes = await fetch(`https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&filter=stream&limit=100`);
    const commentsData = await commentsRes.json();
    const comments = commentsData?.data || [];

    const added = [];

    for (const comment of comments) {
      const message = comment.message;
      const selling_id = normalizeSellingId(message);
      const priceData = extractPrice(message);
      if (!selling_id || !priceData) continue;

      const docRef = productsRef.doc(selling_id);
      await docRef.set({
        selling_id,
        category: selling_id.startsWith('A') ? 'A' : 'B',
        product_name: message,
        price: priceData.price,
        price_raw: priceData.price_raw,
        post_id,
        created_at: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' })
      });

      added.push(selling_id);
    }

    return res.status(200).json({ success: true, message: `已清空旧留言并记录 ${added.length} 项商品`, post_id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
