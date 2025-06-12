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

  // 解析留言格式（如 B01 寿娘子 RM380.00 或 b128～寿娘子rm380）
  const regex = /[Bb]\s*0*(\d+)[\s\S]*?(?:RM|rm)?\s*([\d,.]+)/;
  const match = message.match(regex);

  if (!match) {
    return res.status(400).json({ error: '留言格式不符合要求' });
  }

  const rawId = match[1];
  const rawPrice = match[2];

  const selling_id = `B${rawId.padStart(3, '0')}`;
  const price_raw = parseFloat(rawPrice.replace(/,/g, '')).toFixed(2);
  const price_fmt = parseFloat(price_raw).toLocaleString('en-MY', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  // 商品名称（去除开头符号）
  const product_name = match[0].replace(/^[^\p{L}\p{N}]+/u, '').replace(/[Bb]\s*0*\d+/, '').replace(/(?:RM|rm)?\s*[\d,.]+/, '').trim();

  // 写入数据库
  const { data, error } = await supabase
    .from(process.env.SUPABASE_TABLE_NAME)
    .insert([{ post_id, selling_id, product_name, price_raw, price_fmt }]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, product: { selling_id, product_name, price_raw, price_fmt } });
}
