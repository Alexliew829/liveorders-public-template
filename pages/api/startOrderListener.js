import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' });
  }

  const { post_id, message } = req.body;

  if (!post_id || !message || typeof post_id !== 'string' || typeof message !== 'string') {
    return res.status(400).json({ error: 'post_id 和 message 是必填字段' });
  }

  // 提取商品编号、价格
  const regex = /[Bb]\s*0*(\d+)[^\da-zA-Z]*([\u4e00-\u9fa5\w\s\-·~_]+)[^\d]*(?:RM|rm)?\s*([\d.,]+)/;
  const match = message.match(regex);

  if (!match) {
    return res.status(400).json({ error: '留言格式不正确，无法识别商品信息' });
  }

  const selling_id = 'B' + match[1];
  const raw_product_name = match[2] || '';
  const product_name = raw_product_name.replace(/^[-~_\s]+/, '').trim();
  const price_raw = parseFloat(match[3].replace(/,/g, '')) || 0;
  const price_fmt = price_raw.toFixed(2);

  const { error, data } = await supabase.from(process.env.SUPABASE_TABLE_NAME).insert([
    {
      post_id,
      selling_id,
      product_name,
      price_raw,
      price_fmt,
    }
  ]);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.status(200).json({ success: true, product: { selling_id, product_name, price_raw: price_fmt, post_id } });
}
