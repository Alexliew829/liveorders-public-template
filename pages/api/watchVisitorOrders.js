import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PAGE_ID = process.env.PAGE_ID;
const PAGE_TOKEN = process.env.FB_ACCESS_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

function extractCode(message) {
  const match = message.match(/\b[bB]\s*0*(\d{1,3})\b/);
  if (!match) return null;
  return 'B' + match[1].padStart(3, '0');
}

export default async function handler(req, res) {
  try {
    // 获取最新贴文 ID
    const postRes = await fetch(
      `https://graph.facebook.com/${PAGE_ID}/posts?access_token=${PAGE_TOKEN}&limit=1`
    );
    const postData = await postRes.json();
    const postId = postData?.data?.[0]?.id;
    if (!postId) throw new Error('找不到贴文 ID');

    // 拉留言
    let comments = [];
    let next = `https://graph.facebook.com/${postId}/comments?access_token=${PAGE_TOKEN}&fields=id,message,from&limit=100`;
    while (next) {
      const r = await fetch(next);
      const d = await r.json();
      comments.push(...(d.data || []));
      next = d.paging?.next;
    }

    // 拉出商品列表
    const { data: products } = await supabase.from('live_products').select('*').eq('post_id', postId);
    const productMap = {};
    for (const p of products || []) {
      productMap[p.selling_id] = p;
    }

    const results = [];

    for (const comment of comments) {
      const { message, from, id: comment_id } = comment;
      if (!message || from?.id === PAGE_ID) continue; // 跳过主页留言

      const code = extractCode(message);
      if (!code || !productMap[code]) continue; // 编号不符或商品不存在

      // 检查是否已处理
      const { data: existing } = await supabase
        .from('triggered_comments')
        .select('id')
        .eq('post_id', postId)
        .eq('selling_id', code)
        .limit(1)
        .maybeSingle();

      if (existing) continue; // 已发连接

      // 写入记录
      await supabase.from('triggered_comments').insert({
        comment_id,
        post_id: postId,
        user_id: from?.id || null,
        user_name: from?.name || '匿名',
        selling_id: code,
        created_at: new Date().toISOString()
      });

      // 发给 Make Webhook
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment_id,
          post_id: postId,
          user_id: from?.id || null,
          user_name: from?.name || '匿名用户',
          selling_id: code,
          product_name: productMap[code].product_name,
          price_raw: productMap[code].price_raw,
          price_fmt: productMap[code].price_fmt
        }),
      });

      results.push({ user: from?.name, code });
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
