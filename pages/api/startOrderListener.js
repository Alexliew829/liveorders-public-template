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

  // 正则提取：如 "B128 寿娘子 RM380" 或 "b128-寿娘子rm380" 等
  const regex = /[Bb]\s*0*(\d{1,3})[^\da-zA-Z]*([\u4e00-\u9fa5\w\s]+)[^\d]*(?:RM|rm)?\s*([\d,.]+)/;
  const match = message.match(regex);

  if (!match) {
    return res.status(400).json({ error: '格式无法识别', raw: message });
  }

  const numberRaw = match[1].padStart(3, '0'); // 始终三位数
  const selling_id = `B${numberRaw}`;

  const product_name = match[2].trim().replace(/^[-_\s]+/, ''); // 去除开头符号
  const price_raw = parseFloat((match[3] || '0').replace(/,/g, ''));
  const price_fmt = price_raw.toFixed(2);

  const { error, data } = await supabase.from(process.env.SUPABASE_TABLE_NAME).insert([
    {
      selling_id,
      post_id,
      product_name,
      price_raw: price_fmt,
      price_fmt
    }
  ]);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ success: true, product: { selling_id, product_name, price_raw: price_fmt } });
}
