import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  try {
    // 1. 获取最新贴文 ID
    const postRes = await fetch(
      `https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`
    );
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法取得贴文 ID', raw: postData });
    }

    // 2. 获取留言
    const commentRes = await fetch(
      `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=message,from&limit=100`
    );
    const commentData = await commentRes.json();

    if (!commentData?.data?.length) {
      return res.status(404).json({ error: '找不到任何留言', raw: commentData });
    }

    let successCount = 0;

    for (const comment of commentData.data) {
      const { message, from } = comment;
      if (!message || from?.id !== PAGE_ID) continue; // 只处理主页留言

      // 更精确的正则表达式，确保不把 RM 包含进 product_name
      const regex = /[Bb]\s*0*(\d+)[^\dA-Za-z]*([\u4e00-\u9fa5A-Za-z\s]+?)[\s\-_/～]*[Rr][Mm]?\s*([\d,.]+)/;
      const match = message.match(regex);
      if (!match) continue;

      const rawId = match[1];
      const nameRaw = match[2].trim().replace(/rm$/i, ''); // 去除尾部 rm
      const rawPrice = match[3]?.replace(/,/g, '');

      const selling_id = `B${rawId.padStart(3, '0')}`;
      const product_name = nameRaw;
      const price_raw = parseFloat(rawPrice).toFixed(2);
      const price_fmt = parseFloat(rawPrice).toLocaleString('en-MY', {
        style: 'currency',
        currency: 'MYR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).replace('MYR', 'RM');

      const { error } = await supabase.from(process.env.SUPABASE_TABLE_NAME).insert({
        selling_id,
        post_id,
        product_name,
        price_raw,
        price_fmt
      });

      if (!error) successCount++;
    }

    return res.status(200).json({ success: true, inserted: successCount });
  } catch (err) {
    return res.status(500).json({ error: '服务器错误', detail: err.message });
  }
}
