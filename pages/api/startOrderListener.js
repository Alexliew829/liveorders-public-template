import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只允许 POST 请求' })
  }

  const { post_id, message } = req.body

  if (!post_id || !message || typeof post_id !== 'string' || typeof message !== 'string') {
    return res.status(400).json({ error: 'post_id 和 message 是必填字段' })
  }

  // 解析留言格式（例如 “B01 黄杨矮霸 RM320.00”）
  const regex = /[Bb]\s*0*(\d+)[^a-zA-Z\d]*([\u4e00-\u9fa5\w\s\-]+)?[^0-9]*(?:RM|rm)?\s*([\d.]+)/
  const match = message.match(regex)

  if (!match) {
    return res.status(400).json({ error: '留言格式不符合要求' })
  }

  const [, number, rawName, priceRaw] = match
  const selling_id = `B${number.padStart(3, '0')}`
  const product_name = (rawName || '').trim()
  const price_fmt = parseFloat(priceRaw).toFixed(2)

  const { data, error } = await supabase.from(process.env.SUPABASE_TABLE_NAME).insert([
    {
      post_id,
      selling_id,
      product_name,
      price_raw: priceRaw,
      price_fmt,
    }
  ])

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ success: true, product: { selling_id, product_name, price_raw: priceRaw, price_fmt } })
}
