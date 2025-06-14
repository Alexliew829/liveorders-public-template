import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

export default async function handler(req, res) {
  const DEBUG = req.query.debug === 'true';

  try {
    // 获取贴文 ID
    const postRes = await fetch(
      `https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`
    );
    const postData = await postRes.json();
    const post_id = postData?.data?.[0]?.id;

    if (!post_id) {
      return res.status(404).json({ error: '无法获取贴文 ID', raw: postData });
    }

    // 获取留言
    const commentRes = await fetch(
      `https://graph.facebook.com/${post_id}/comments?access_token=${PAGE_TOKEN}&fields=id,message,from&limit=100`
    );
    const commentData = await commentRes.json();
    const comments = commentData?.data || [];

    const results = [];

    for (const c of comments) {
      const { id: comment_id, message, from } = c;
      const user_id = from?.id || null;
      const user_name = from?.name || '匿名用户';

      if (!message) continue;

      // ✅ 允许主页留言测试（仅 debug 模式）
      if (!DEBUG && user_id === PAGE_ID) continue;

      const match = message.match(/\b[bB]\s*0*(\d{1,3})\b/);
      if (!match) continue;

      const rawId = match[1];
      const selling_id = 'B' + rawId.padStart(3, '0');

      // 检查商品是否存在
      const { data: productRow } = await supabase
        .from('live_products')
        .select('*')
        .eq('selling_id', selling_id)
        .eq('post_id', post_id)
        .maybeSingle();

      if (!productRow) continue;

      // 检查是否已有回应
      const { data: existing } = await supabase
        .from('triggered_comments')
        .select('*')
        .eq('selling_id', selling_id)
        .eq('post_id', post_id)
        .maybeSingle();

      if (existing) continue;

      // 写入触发记录
      await supabase.from('triggered_comments').insert({
        selling_id,
        post_id,
        comment_id,
        user_id,
        user_name
      });

      results.push({
        comment_id,
        post_id,
        user_id,
        user_name,
        selling_id,
        product_name: productRow.product_name,
        price_raw: productRow.price_raw,
        price_fmt: productRow.price_fmt
      });
    }

    // 发给 Make（如果有符合的留言）
    if (results.length > 0) {
      await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: results })
      });
    }

    return res.status(200).json({
      message: '处理完成',
      total: results.length,
      sent: results
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
