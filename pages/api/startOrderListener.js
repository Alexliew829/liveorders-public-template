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

  // 标号与价格提取：如 B127 小红帽 RM1800.00、b127-寿娘子rm 380 等
  const regex = /([Bb]\s*0*\d{1,3})[^\dRMrm]{1,10}(?:RM|rm)?\s*(\d{1,5}(?:\.\d{1,2})?)/;
  const match = message.match(regex);

  if (!match) {
    return res.status(400).json({ error: '留言格式无法解析', raw: message });
  }

  const raw_id = match[1].toUpperCase().replace(/\s+/g, '');
  const numberPart = raw_id.replace(/[^0-9]/g, '').padStart(3, '0');
  const selling_id = 'B' + numberPart;

  const product_name = message
    .replace(match[1], '')
    .replace(match[2], '')
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9\s]/g, '') // 删除符号
    .replace(/\s+/g, '') // 删除空白
    .replace(/RM|rm/gi, '') // 删除RM文字
    .trim();

  const price_raw = parseFloat(match[2]).toFixed(2);
  const price_fmt = parseFloat(price_raw).toLocaleString('en-MY', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  try {
    const { error } = await supabase.from('live_products').insert({
      selling_id,
      post_id,
      product_name,
      price_raw,
      price_fmt
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({
      success: true,
      product: {
        selling_id,
        product_name,
        price_raw,
        price_fmt
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
